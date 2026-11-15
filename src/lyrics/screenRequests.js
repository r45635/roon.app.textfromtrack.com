'use strict';

/**
 * The tracks other screens asked lyrics for through the LRCLIB-compatible GET /api/get.
 *
 * With Roon disabled the companion never learns what is playing: a TFT Panel in direct mode
 * asks for the words of its track and that request is all we see. Remembering the last few
 * lets the web UI offer the corrections the player has (Wrong lyrics, Other versions, Paste,
 * timing offset) for a song that only played on a panel.
 *
 * Kept in memory only, newest first, one entry per track (asked again = moved to the top).
 * No address of the asking device is kept.
 */

const config = require('../config');
const lrcCache = require('../utils/lrcCache');
const { readJson } = require('../utils/fileUtils');

const MAX_ENTRIES = 50;
const _entries = new Map(); // track_id -> entry, insertion order = oldest first

/**
 * @param {{ title, artist, album, duration_seconds }} track
 * @param {{ found?, source?, synced?, instrumental?, marked_wrong?, error? }} lyrics what was answered
 */
function record(track, lyrics = {}) {
  if (!track || !track.title || !track.artist) return;
  const trackId = lrcCache.metaId(track.artist, track.title, track.album);
  const previous = _entries.get(trackId);
  _entries.delete(trackId);
  _entries.set(trackId, {
    track_id: trackId,
    title: track.title,
    artist: track.artist,
    album: track.album || null,
    duration_seconds: track.duration_seconds || null,
    asked_at: new Date().toISOString(),
    times: (previous ? previous.times : 0) + 1,
    found: !!lyrics.found,
    synced: !!lyrics.synced,
    instrumental: !!lyrics.instrumental,
    source: lyrics.source || null,
    marked_wrong: !!lyrics.marked_wrong,
    error: !!lyrics.error,
  });
  while (_entries.size > MAX_ENTRIES) _entries.delete(_entries.keys().next().value);
}

/**
 * Newest first. `marked_wrong` and `offset_ms` are read from the track's preferences now, not
 * from the last answer, so a correction made since shows at once.
 */
function list() {
  const prefs = readJson(config.lyricsPrefsPath, {});
  return [..._entries.values()].reverse().map((entry) => {
    const p = prefs[entry.track_id] || {};
    return { ...entry, marked_wrong: !!p.wrong, offset_ms: p.offset_ms || 0 };
  });
}

function _reset() {
  _entries.clear();
}

module.exports = { record, list, MAX_ENTRIES, _reset };
