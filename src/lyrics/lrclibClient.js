'use strict';

const https = require('https');

const LRCLIB_BASE = 'https://lrclib.net';
const { version } = require('../../package.json');

const USER_AGENT = `TextFromTrackRoonCompanion/${version} (https://github.com/r45635/roon.app.textfromtrack.com)`;

const LRCLIB_TIMEOUT_MS = 20000; // per-request hard deadline (connect + download)

// A busy LRCLIB answers 503 on some requests and 200 on the next one: retry a 503/429 once
// after a short wait (Retry-After when it is short) before reporting it.
const BUSY_RETRY = { defaultWaitMs: 1500, maxWaitMs: 5000 };

/**
 * One GET request to LRCLIB (no retry); resolves with { status, body } (body = parsed JSON or null),
 * or null on 404. Uses a hard deadline so slow connections don't block forever.
 */
function _getOnce(urlPath) {
  return new Promise((resolve, reject) => {
    const url = `${LRCLIB_BASE}${urlPath}`;

    // Hard timeout: fires whether the socket is idle or just slow.
    const timer = setTimeout(() => {
      req.destroy(new Error(`LRCLIB request timed out after ${LRCLIB_TIMEOUT_MS / 1000}s`));
    }, LRCLIB_TIMEOUT_MS);

    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      const chunks = [];
      res.on('data', chunk => { chunks.push(chunk); });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode === 404) return resolve(null);
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

/**
 * GET from LRCLIB; resolves with { status, body } (body = parsed JSON or null), or null on 404.
 * One quick retry when LRCLIB is busy (503/429).
 */
async function lrclibGet(urlPath) {
  const first = await _getOnce(urlPath);
  if (!first || (first.status !== 503 && first.status !== 429)) return first;
  const hinted = Number.isFinite(first.retryAfterS) ? first.retryAfterS * 1000 : BUSY_RETRY.defaultWaitMs;
  await new Promise(r => setTimeout(r, Math.min(Math.max(hinted, 250), BUSY_RETRY.maxWaitMs)));
  return _getOnce(urlPath);
}

/**
 * Body of a 2xx response; null when LRCLIB has no such record (404, empty body).
 * Throws on any other status (503 "ServerOverloaded", 429, 5xx): a busy server is not
 * "no lyrics", and must not be remembered as such.
 */
function _body(result) {
  if (!result) return null; // 404
  if (result.status >= 200 && result.status < 300) return result.body;
  const detail = result.body && (result.body.message || result.body.name);
  throw new Error(`LRCLIB HTTP ${result.status}${detail ? `: ${detail}` : ''}`);
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

module.exports = { lrclibGet, getTrack, search, getById, USER_AGENT };
