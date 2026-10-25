'use strict';

const https = require('https');

const LRCLIB_BASE = 'https://lrclib.net';
const USER_AGENT = 'TextFromTrackRoonCompanion/1.0 (https://roon.app.textfromtrack.com)';

const LRCLIB_TIMEOUT_MS = 20000; // per-request hard deadline (connect + download)

/**
 * Performs a GET request to LRCLIB and resolves with { status, body } (body = parsed JSON or null),
 * or null on 404. Uses a hard deadline so slow connections don't block forever.
 */
function lrclibGet(urlPath) {
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
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: null });
        }
      });
      res.on('error', err => { clearTimeout(timer); reject(err); });
    });
    req.on('error', err => { clearTimeout(timer); reject(err); });
  });
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

module.exports = { lrclibGet, getTrack, search, getById };
