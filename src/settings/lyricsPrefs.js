'use strict';

/**
 * Per-track lyrics preferences, keyed by lrcCache.metaId (artist + title + album):
 * the LRCLIB version the user picked, their timing offset, and whether they marked the
 * lyrics as wrong.
 * Stored in storage/lyrics-prefs.json.
 */

const config = require('../config');
const { readJson, writeJson } = require('../utils/fileUtils');

/**
 * @param {string} trackId
 * @returns {{ lrclib_id?: number, offset_ms?: number, wrong?: boolean }}
 */
function get(trackId) {
  const all = readJson(config.lyricsPrefsPath, {});
  return all[trackId] || {};
}

/**
 * Merge `updates` into a track's preferences. A null value removes that key.
 * @param {string} trackId
 * @param {{ lrclib_id?: number|null, offset_ms?: number|null, wrong?: boolean|null }} updates
 * @returns {{ lrclib_id?: number, offset_ms?: number, wrong?: boolean }}
 */
function set(trackId, updates) {
  const all = readJson(config.lyricsPrefsPath, {});
  const next = { ...(all[trackId] || {}) };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  if (Object.keys(next).length) all[trackId] = next;
  else delete all[trackId];
  writeJson(config.lyricsPrefsPath, all);
  return next;
}

module.exports = { get, set };
