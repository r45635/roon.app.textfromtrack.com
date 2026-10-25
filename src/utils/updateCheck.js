'use strict';

/**
 * Tells whether a newer release is published on GitHub. Checked at most every 6 hours;
 * UPDATE_CHECK=false turns it off (no request to GitHub at all).
 */

const https = require('https');
const logger = require('./logger');
const { version: currentVersion } = require('../../package.json');

const RELEASES_URL = 'https://api.github.com/repos/r45635/roon.app.textfromtrack.com/releases/latest';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_ERROR_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 10000;

let _cache = null;        // { latest, url, checked_at }
let _nextCheckAt = 0;
let _inFlight = null;

/** -1 / 0 / 1 comparing "1.2.3" style versions (a leading "v" and pre-release tags ignored). */
function compareVersions(a, b) {
  const parse = v => String(v).replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function _fetchLatest() {
  return new Promise((resolve, reject) => {
    const req = https.get(RELEASES_URL, {
      headers: { 'User-Agent': `TextFromTrackRoonCompanion/${currentVersion}`, Accept: 'application/vnd.github+json' },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub HTTP ${res.statusCode}`));
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ latest: String(body.tag_name || '').replace(/^v/, ''), url: body.html_url || null });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('GitHub request timed out')));
    req.on('error', reject);
  });
}

/**
 * @returns {Promise<{ enabled: boolean, current: string, latest: string|null,
 *   update_available: boolean, url: string|null, checked_at: string|null, error?: string }>}
 */
async function getUpdateInfo() {
  const enabled = String(process.env.UPDATE_CHECK || '').toLowerCase() !== 'false';
  const base = { enabled, current: currentVersion, latest: null, update_available: false, url: null, checked_at: null };
  if (!enabled) return base;

  let error;
  if (Date.now() >= _nextCheckAt) {
    if (!_inFlight) {
      _inFlight = _fetchLatest()
        .then(r => {
          _cache = { ...r, checked_at: new Date().toISOString() };
          _nextCheckAt = Date.now() + CHECK_EVERY_MS;
        })
        .catch(err => {
          logger.warn({ err: err.message }, 'Update check failed');
          _nextCheckAt = Date.now() + RETRY_AFTER_ERROR_MS;
          throw err;
        })
        .finally(() => { _inFlight = null; });
    }
    try { await _inFlight; } catch (err) { error = err.message; }
  }
  if (!_cache) return { ...base, ...(error ? { error } : {}) };
  return {
    ...base,
    latest: _cache.latest || null,
    url: _cache.url,
    checked_at: _cache.checked_at,
    update_available: !!_cache.latest && compareVersions(_cache.latest, currentVersion) > 0,
  };
}

module.exports = { getUpdateInfo, compareVersions };
