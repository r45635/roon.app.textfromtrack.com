'use strict';

/**
 * Finds the lyrics of a track from its metadata, with or without a local file.
 *
 * Order: the matched local file (.lrc sidecar, then embedded tags, then the path cache),
 * the metadata cache, then LRCLIB (exact lookup, then search). LRCLIB hits are written to the
 * metadata cache, so a lyrics-only setup (no music folder) still builds a local cache.
 * Misses and errors are remembered for a while so a track costs at most one LRCLIB round per
 * session, however many viewers ask.
 */

const logger = require('../utils/logger');
const { AppError, E } = require('../utils/normalize');
const lrcCache = require('../utils/lrcCache');
const lyricsDetector = require('../music/lyricsDetector');
const lyricsPrefs = require('../settings/lyricsPrefs');
const lrclibClient = require('./lrclibClient');

const NOT_FOUND_TTL_MS = 30 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;
const MEMO_MAX = 1000;
const DURATION_TOLERANCE_S = 5;
const MAX_OFFSET_MS = 30000;

const _memo = new Map();     // trackId -> { result, expires } (LRCLIB misses, errors, instrumentals)
const _inFlight = new Map(); // trackId -> Promise of the LRCLIB result

/** True when the text holds at least one LRC timestamp line. */
function isSynced(text) {
  return /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m.test(text || '');
}

function _fromText(text) {
  return { found: true, instrumental: false, text, synced: isSynced(text) };
}

function _fromRecord(rec) {
  if (rec.instrumental) {
    return { found: true, instrumental: true, text: null, synced: false, lrclib_id: rec.id ?? null };
  }
  const text = rec.syncedLyrics || rec.plainLyrics || null;
  if (!text) return { found: false };
  return { found: true, instrumental: false, text, synced: !!rec.syncedLyrics, lrclib_id: rec.id ?? null };
}

/**
 * Pick the best search hit: synced and close in duration, then any synced, then close in
 * duration, then the first usable one.
 */
function pickHit(hits, durationSeconds) {
  const usable = hits.filter(h => h && (h.syncedLyrics || h.plainLyrics || h.instrumental));
  const near = h => !durationSeconds || !h.duration
    || Math.abs(h.duration - durationSeconds) <= DURATION_TOLERANCE_S;
  return usable.find(h => h.syncedLyrics && near(h))
    || usable.find(h => h.syncedLyrics)
    || usable.find(near)
    || usable[0]
    || null;
}

/**
 * Roon titles often carry decorations LRCLIB doesn't have: "(Remastered 2011)",
 * "[Live]", "- 2009 Remaster", "(including Horse Latitudes)". Roon also joins several
 * artists with " / ". Returns the simplified title and the first artist.
 */
function simplify({ title, artist }) {
  const simpleTitle = (title || '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*\b(remaster(ed)?|live|version|mix|edit|mono|stereo|demo|take)\b.*$/i, '')
    .trim();
  const firstArtist = (artist || '').split(/\s+\/\s+/)[0].trim();
  return { title: simpleTitle || title, artist: firstArtist || artist };
}

async function _fetchFromLrclib(track) {
  const { title, artist, album, duration_seconds: duration } = track;
  const exact = await lrclibClient.getTrack({ title, artist, album, duration });
  if (exact && (exact.syncedLyrics || exact.instrumental)) return _fromRecord(exact);

  // No exact record, or one with plain lyrics only: a search may find a synced version.
  let best = pickHit(await lrclibClient.search({ title, artist }), duration);
  const simple = simplify(track);
  if (!(best && best.syncedLyrics) && (simple.title !== title || simple.artist !== artist)) {
    const retry = pickHit(await lrclibClient.search(simple), duration);
    if (retry && (retry.syncedLyrics || !best)) best = retry;
  }
  if (best && (best.syncedLyrics || !exact)) return _fromRecord(best);
  return exact ? _fromRecord(exact) : { found: false };
}

function _remember(trackId, result, ttlMs) {
  if (_memo.size >= MEMO_MAX) _memo.delete(_memo.keys().next().value);
  _memo.set(trackId, { result, expires: Date.now() + ttlMs });
}

function _lrclib(trackId, track) {
  const memo = _memo.get(trackId);
  if (memo && memo.expires > Date.now()) return Promise.resolve(memo.result);
  if (_inFlight.has(trackId)) return _inFlight.get(trackId);

  const promise = _fetchFromLrclib(track)
    .then(result => {
      if (result.found && result.text) {
        lrcCache.setByMeta(track.artist, track.title, track.album, result.text);
      } else {
        _remember(trackId, result, result.instrumental ? Infinity : NOT_FOUND_TTL_MS);
      }
      return result;
    })
    .catch(err => {
      logger.warn({ err: err.message, title: track.title, artist: track.artist }, 'LRCLIB lookup failed');
      const result = { found: false, error: err.message };
      _remember(trackId, result, ERROR_TTL_MS);
      return result;
    })
    .finally(() => _inFlight.delete(trackId));
  _inFlight.set(trackId, promise);
  return promise;
}

function _trackId(track) {
  return lrcCache.metaId(track.artist, track.title, track.album);
}

/**
 * Resolve the lyrics of a track.
 * @param {{ title, artist, album, duration_seconds }} track
 * @param {{ audioPath?: string|null, refresh?: boolean }} [opts] matched local file, if any
 *   (already validated); refresh = ignore a remembered LRCLIB miss or error
 * @returns {Promise<{ found: boolean, source: string|null, text: string|null, synced: boolean,
 *   instrumental: boolean, track_id: string|null, lrclib_id: number|null, offset_ms: number,
 *   error?: string }>}
 */
async function resolve(track, { audioPath = null, refresh = false } = {}) {
  if (!track || !track.title || !track.artist) {
    return { found: false, source: null, text: null, synced: false, instrumental: false,
      track_id: null, lrclib_id: null, offset_ms: 0 };
  }
  const trackId = _trackId(track);
  // "Retry": forget a remembered miss or error and ask LRCLIB again.
  if (refresh) _memo.delete(trackId);
  const prefs = lyricsPrefs.get(trackId);
  const base = { track_id: trackId, lrclib_id: prefs.lrclib_id ?? null, offset_ms: prefs.offset_ms || 0 };

  if (audioPath) {
    try {
      const local = await lyricsDetector.readLocalLyrics(audioPath);
      if (local) return { ...base, ..._fromText(local.text), source: local.source === 'lrc' ? 'sidecar' : 'embedded' };
    } catch (err) {
      logger.warn({ err: err.message, audioPath }, 'lyricsResolver: cannot read local lyrics');
    }
    const byPath = lrcCache.get(audioPath);
    if (byPath) return { ...base, ..._fromText(byPath), source: 'cache' };
  }

  const cached = lrcCache.getByMeta(track.artist, track.title, track.album);
  if (cached) return { ...base, ..._fromText(cached), source: 'cache' };

  const remote = await _lrclib(trackId, track);
  return {
    ...base,
    text: null,
    synced: false,
    instrumental: false,
    ...remote,
    lrclib_id: remote.lrclib_id ?? base.lrclib_id,
    source: remote.found ? 'lrclib' : null,
  };
}

/**
 * Use a specific LRCLIB record for this track from now on (replaces the cached lyrics).
 * @param {{ title, artist, album }} track
 * @param {number} lrclibId
 */
async function choose(track, lrclibId) {
  const rec = await lrclibClient.getById(lrclibId);
  if (!rec) throw new AppError(E.NOT_FOUND, `LRCLIB record ${lrclibId} not found`);
  const result = _fromRecord(rec);
  if (!result.found) throw new AppError(E.NOT_FOUND, `LRCLIB record ${lrclibId} has no lyrics`);

  const trackId = _trackId(track);
  _memo.delete(trackId);
  if (result.text) lrcCache.setByMeta(track.artist, track.title, track.album, result.text);
  else _remember(trackId, result, Infinity);
  const prefs = lyricsPrefs.set(trackId, { lrclib_id: rec.id ?? lrclibId });
  return {
    ...result,
    source: 'lrclib',
    track_id: trackId,
    lrclib_id: prefs.lrclib_id,
    offset_ms: prefs.offset_ms || 0,
  };
}

/**
 * Save the timing offset of a track. Positive = lyrics shown later.
 * @param {{ title, artist, album }} track
 * @param {number} offsetMs
 * @returns {number} the stored offset
 */
function setOffset(track, offsetMs) {
  const clamped = Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, Math.round(offsetMs / 10) * 10));
  lyricsPrefs.set(_trackId(track), { offset_ms: clamped || null });
  return clamped;
}

/**
 * Store lyrics the user edited (e.g. timestamps stamped in the LRC editor) as this track's
 * lyrics: they replace the cached copy, and the picked LRCLIB version and offset are reset
 * (the timing is now in the text itself).
 * @param {{ title, artist, album }} track
 * @param {string} text
 */
function saveCustom(track, text) {
  const trackId = _trackId(track);
  lrcCache.setByMeta(track.artist, track.title, track.album, text);
  lyricsPrefs.set(trackId, { lrclib_id: null, offset_ms: null });
  _memo.delete(trackId);
  return { ..._fromText(text), source: 'cache', track_id: trackId, lrclib_id: null, offset_ms: 0 };
}

/** Test hook: forget remembered LRCLIB results. */
function _resetMemo() {
  _memo.clear();
  _inFlight.clear();
}

/**
 * One LRCLIB lookup with no memo and no cache — for batch jobs that handle retries and
 * caching themselves. Throws when LRCLIB is unreachable or busy.
 * @param {{ title, artist, album, duration_seconds }} track
 */
function lookupLrclib(track) {
  return _fetchFromLrclib(track);
}

module.exports = { resolve, choose, setOffset, saveCustom, lookupLrclib, isSynced, pickHit, simplify, _resetMemo };
