'use strict';

/**
 * LRCLIB HTTP client. Requests go to an ordered list of LRCLIB servers — lrclib.net by default,
 * or mirrors the user runs (same API, serving a dump of the same database) — and fall through
 * to the next one when a server fails or doesn't have the record.
 */

const http = require('http');
const https = require('https');
const config = require('../config');
const userSettings = require('../settings/userSettings');
const logger = require('../utils/logger');

const DEFAULT_URLS = ['https://lrclib.net'];
const MAX_SERVERS = 5;
const { version } = require('../../package.json');

const USER_AGENT = `TextFromTrackRoonCompanion/${version} (https://github.com/r45635/roon.app.textfromtrack.com)`;

// Per-request hard deadline (connect + download). lrclib.net can be slow when busy; a mirror
// that takes longer than 5 s is down, or out of reach (a LAN address seen from elsewhere).
const LRCLIB_TIMEOUT_MS = 20000;
const MIRROR_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// A server that failed at the network level (refused, unreachable, timed out) is skipped for a
// minute, so a mirror out of reach doesn't add its deadline to every request.
const COOLDOWN_MS = 60 * 1000;
const _cooldownUntil = new Map(); // server URL -> time it may be asked again

// A busy LRCLIB answers 503 on some requests and 200 on the next one: retry a 503/429 once
// after a short wait (Retry-After when it is short) before reporting it.
const BUSY_RETRY = { defaultWaitMs: 1500, maxWaitMs: 5000 };

/**
 * Canonical form of a server URL: http(s) only, no credentials, query or fragment, no trailing
 * slash. A path prefix is kept (a server behind "/lrclib"). Throws on anything else.
 * @param {string} raw
 * @returns {string}
 */
function normalizeServerUrl(raw) {
  const text = String(raw ?? '').trim();
  let url;
  try { url = new URL(text); } catch { throw new Error(`Not a valid URL: "${text}"`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http:// and https:// servers are supported: "${text}"`);
  }
  if (url.username || url.password) throw new Error(`No user name or password in the URL: "${text}"`);
  if (url.search || url.hash || text.includes('?') || text.includes('#')) {
    throw new Error(`No query or fragment in the URL: "${text}"`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Validate an ordered list of server URLs: every entry normalized, duplicates dropped.
 * Throws on the first invalid entry, or when there are too many.
 * @param {string[]} list
 * @returns {string[]}
 */
function normalizeServerList(list) {
  const urls = [...new Set(list.map(normalizeServerUrl))];
  if (urls.length > MAX_SERVERS) throw new Error(`At most ${MAX_SERVERS} LRCLIB servers`);
  return urls;
}

let _warnedInvalid = '';
function _usable(list, origin) {
  const urls = [];
  for (const raw of list) {
    try { urls.push(normalizeServerUrl(raw)); } catch (err) {
      // Logged once per distinct problem, not on every request.
      if (_warnedInvalid !== err.message) logger.warn({ err: err.message, origin }, 'LRCLIB server ignored');
      _warnedInvalid = err.message;
    }
  }
  return [...new Set(urls)].slice(0, MAX_SERVERS);
}

/**
 * The servers to ask, in order, and where the list comes from. The app setting wins over the
 * LRCLIB_URLS env var, which wins over lrclib.net alone. Read on every request, so a change in
 * the UI applies at once.
 * @returns {{ urls: string[], source: 'user_settings'|'env'|'default' }}
 */
function getServers() {
  const stored = userSettings.get().lrclib_urls;
  if (Array.isArray(stored) && stored.length) {
    const urls = _usable(stored, 'user_settings');
    if (urls.length) return { urls, source: 'user_settings' };
  }
  const fromEnv = _usable(config.lrclibUrls || [], 'env');
  if (fromEnv.length) return { urls: fromEnv, source: 'env' };
  return { urls: DEFAULT_URLS, source: 'default' };
}

/** "192.168.2.57:3300", "lrclib.net", "example.com/lrclib": how a server is named in messages. */
function serverLabel(base) {
  const url = new URL(base);
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
}

function _timeoutFor(base) {
  return new URL(base).hostname === 'lrclib.net' ? LRCLIB_TIMEOUT_MS : MIRROR_TIMEOUT_MS;
}

/**
 * One GET request to one server (no retry); resolves with { status, body, retryAfterS }
 * (body = parsed JSON or null). Rejects on network errors, the hard deadline, or a body too large.
 */
function _getOnce(base, urlPath) {
  const timeoutMs = _timeoutFor(base);
  return new Promise((resolve, reject) => {
    const url = `${base}${urlPath}`;
    const transport = url.startsWith('https:') ? https : http;

    // Hard timeout: fires whether the socket is idle or just slow.
    const timer = setTimeout(() => {
      req.destroy(new Error(`LRCLIB request timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const req = transport.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(new Error(`LRCLIB answer larger than ${MAX_BODY_BYTES / 1024 / 1024} MB`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(timer);
        const retryAfterS = parseFloat(res.headers['retry-after']);
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: JSON.parse(raw), retryAfterS });
        } catch {
          resolve({ status: res.statusCode, body: null, retryAfterS });
        }
      });
      res.on('error', err => { clearTimeout(timer); reject(err); });
    });
    req.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

function _httpError(result) {
  const detail = result.body && (result.body.message || result.body.name);
  return `LRCLIB HTTP ${result.status}${detail ? `: ${detail}` : ''}`;
}

function _isBusy(result) {
  return result.status === 503 || result.status === 429;
}

/** The single error of a one-server list reads as before; a longer list names each server. */
function _describe(failures, servers) {
  if (servers.length === 1 && failures.length === 1) return failures[0].message;
  return failures.map(f => `${serverLabel(f.base)}: ${f.message}`).join('; ');
}

/**
 * GET from the LRCLIB servers in order; resolves with the first { status, body } that has the
 * record, or null when the last server doesn't have it (404, or an empty search).
 *
 * - An earlier server can only add hits: its 404 or empty search means "not here", ask the next.
 *   A mirror serves a dump, so it lags behind lrclib.net.
 * - A miss is decided by the last server. If it fails, the request fails, even when an earlier
 *   server said 404: a busy server is not "no lyrics", and must not be remembered as such.
 * - A busy earlier server (503/429) passes to the next at once; the last one gets one quick retry.
 * - Throws with every server's error when none could answer.
 */
async function lrclibGet(urlPath) {
  const servers = getServers().urls;
  const failures = [];
  const path = urlPath.split('?')[0];

  for (let i = 0; i < servers.length; i++) {
    const base = servers[i];
    const last = i === servers.length - 1;
    if (!last && (_cooldownUntil.get(base) || 0) > Date.now()) continue;

    let result;
    try {
      result = await _getOnce(base, urlPath);
      if (last && _isBusy(result)) {
        const hinted = Number.isFinite(result.retryAfterS) ? result.retryAfterS * 1000 : BUSY_RETRY.defaultWaitMs;
        await new Promise(r => setTimeout(r, Math.min(Math.max(hinted, 250), BUSY_RETRY.maxWaitMs)));
        result = await _getOnce(base, urlPath);
      }
    } catch (err) {
      _cooldownUntil.set(base, Date.now() + COOLDOWN_MS);
      failures.push({ base, message: err.message });
      if (!last) logger.info({ server: serverLabel(base), path, err: err.message }, 'LRCLIB server failed, asking the next one');
      continue;
    }
    _cooldownUntil.delete(base);

    const ok = result.status >= 200 && result.status < 300 && result.body !== null;
    const notHere = (result.status === 404 && result.body !== null)
      || (ok && Array.isArray(result.body) && result.body.length === 0);
    if (ok && (!notHere || last)) {
      logger.debug({ server: serverLabel(base), path }, 'LRCLIB answered');
      return result;
    }
    if (notHere) {
      if (last) return null;
      logger.debug({ server: serverLabel(base), path }, 'LRCLIB server has no such record, asking the next one');
      continue;
    }
    const message = result.body === null && result.status < 300
      ? `LRCLIB HTTP ${result.status}: not an LRCLIB answer`
      : _httpError(result);
    failures.push({ base, message });
    if (!last) logger.info({ server: serverLabel(base), path, err: message }, 'LRCLIB server failed, asking the next one');
  }
  throw new Error(_describe(failures, servers));
}

/** Forget which servers were skipped after a network failure (the "Retry" button, a new list). */
function clearCooldowns() {
  _cooldownUntil.clear();
}

/**
 * Check that a server answers like LRCLIB: GET /api/get/1, with that server's deadline.
 * A JSON 404 also counts (a server whose database has no record 1).
 * @param {string} rawUrl
 * @returns {Promise<{ ok: boolean, status: number|null, ms: number, error: string|null }>}
 */
async function probe(rawUrl) {
  const base = normalizeServerUrl(rawUrl);
  const started = Date.now();
  try {
    const result = await _getOnce(base, '/api/get/1');
    const ms = Date.now() - started;
    const ok = result.body !== null && (result.status === 200 || result.status === 404);
    if (ok) _cooldownUntil.delete(base);
    const error = ok ? null : (result.body === null ? `HTTP ${result.status}: not an LRCLIB answer` : _httpError(result));
    return { ok, status: result.status, ms, error };
  } catch (err) {
    return { ok: false, status: null, ms: Date.now() - started, error: err.message };
  }
}

/** Body of an answer from lrclibGet; null when no server has the record. */
function _body(result) {
  return result ? result.body : null;
}

/**
 * Exact lookup (/api/get) by title + artist, optionally album and duration.
 * @returns {Promise<object|null>} the LRCLIB record, or null when not found
 */
async function getTrack({ title, artist, album, duration }) {
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) params.set('album_name', album);
  if (duration) params.set('duration', String(Math.round(Number(duration))));
  return _body(await lrclibGet(`/api/get?${params.toString()}`)) || null;
}

/**
 * Fuzzy search (/api/search) by title + artist.
 * @returns {Promise<object[]>} LRCLIB records (with lyrics), possibly empty
 */
async function search({ title, artist }) {
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  const body = _body(await lrclibGet(`/api/search?${params.toString()}`));
  return Array.isArray(body) ? body : [];
}

/**
 * Fetch one LRCLIB record by numeric id.
 * @returns {Promise<object|null>}
 */
async function getById(id) {
  return _body(await lrclibGet(`/api/get/${id}`)) || null;
}

module.exports = {
  lrclibGet, getTrack, search, getById, USER_AGENT,
  getServers, normalizeServerUrl, normalizeServerList, serverLabel, probe, clearCooldowns,
  DEFAULT_URLS, MAX_SERVERS,
};
