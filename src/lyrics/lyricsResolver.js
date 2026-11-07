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

// Words that mark a different recording of the same song: a live take has other timings, an
// instrumental has no words. Looked for in the title and the album, on both sides.
const VERSION_WORDS = /\b(live|en public|en concert|in concert|en direct|unplugged|acoustic|acoustique|remix|instrumental|karaoke)\b/i;

function _versionMark(...parts) {
  return VERSION_WORDS.test(parts.filter(Boolean).join(' '));
}

/**
 * How well an LRCLIB record fits the playing track, as a sort key (lower is better):
 * 1. its length — the same recording first (within DURATION_TOLERANCE_S), then a record with
 *    no length, then the others, closest first;
 * 2. the same kind of recording (live / instrumental / remix… on both sides or on neither);
 * 3. synced lyrics before plain ones;
 * 4. the same album (the exact record LRCLIB matched on title, artist and album), then the
 *    closest length.
 * The length comes first on purpose: synced lyrics of another recording (a live take 30 s
 * longer) drift away from the music, while plain lyrics of the right one are just not synced.
 */
function _fitKey(hit, track) {
  const want = Number(track.duration_seconds) || 0;
  const delta = want && hit.duration ? Math.abs(hit.duration - want) : null;
  const lengthClass = delta == null ? 1 : delta <= DURATION_TOLERANCE_S ? 0 : 2;
  const otherKind = _versionMark(track.title, track.album) !== _versionMark(hit.trackName, hit.albumName) ? 1 : 0;
  const otherAlbum = track.album && _fold(hit.albumName) === _fold(track.album) ? 0 : 1;
  return [lengthClass, lengthClass === 2 ? delta : 0, otherKind, hit.syncedLyrics ? 0 : 1, otherAlbum, delta || 0];
}

/** Case, accents and punctuation folded away: "Révolution (Album Version)" ~ "revolution album version". */
function _fold(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function _compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * LRCLIB records sorted from the best fit to the worst (see _fitKey), duplicates dropped.
 * Records with no lyrics at all (and not instrumental) are left out unless keepEmpty.
 * @param {object[]} hits LRCLIB records
 * @param {{ title?, album?, duration_seconds? }|number} track the playing track (or its length)
 */
function rankHits(hits, track, { keepEmpty = false } = {}) {
  const t = typeof track === 'number' || track == null ? { duration_seconds: track } : track;
  const seen = new Set();
  const usable = (hits || []).filter(h => {
    if (!h || (!keepEmpty && !(h.syncedLyrics || h.plainLyrics || h.instrumental))) return false;
    if (h.id != null && seen.has(h.id)) return false;
    if (h.id != null) seen.add(h.id);
    return true;
  });
  return usable
    .map((h, i) => ({ h, i, key: _fitKey(h, t) }))
    .sort((a, b) => _compareKeys(a.key, b.key) || a.i - b.i)
    .map(x => x.h);
}

/** The best fit among LRCLIB records, or null (see rankHits). */
function pickHit(hits, track) {
  return rankHits(hits, track)[0] || null;
}

/** Synced, the right length (or no length to compare) and the same kind of recording. */
function _isIdeal(hit, track) {
  if (!hit || !hit.syncedLyrics) return false;
  const [lengthClass, , otherKind] = _fitKey(hit, track);
  return lengthClass < 2 && otherKind === 0;
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

  // No exact record, or one with plain lyrics only: a search may find a synced copy of the
  // same recording. The exact record stays a candidate — first, so it wins a tie.
  const candidates = exact ? [exact] : [];
  candidates.push(...await lrclibClient.search({ title, artist }));
  let best = pickHit(candidates, track);

  const simple = simplify(track);
  // "Last night (instrumental)" simplified is "Last night", whose hits are the sung version.
  const dropsKind = /instrumental|karaoke/i.test(title) && !/instrumental|karaoke/i.test(simple.title);
  if (!_isIdeal(best, track) && !dropsKind && (simple.title !== title || simple.artist !== artist)) {
    candidates.push(...await lrclibClient.search(simple));
    best = pickHit(candidates, track);
  }
  return best ? _fromRecord(best) : { found: false };
}

function _remember(trackId, result, ttlMs) {
  if (_memo.size >= MEMO_MAX) _memo.delete(_memo.keys().next().value);
  _memo.set(trackId, { result, expires: Date.now() + ttlMs });
}

/**
 * The version the user picked in "Other versions" when there is one (its cached copy may have
 * been cleared), else the best fit.
 */
async function _fetchChosenOrBest(track, pickedId) {
  if (pickedId) {
    const rec = await lrclibClient.getById(pickedId);
    const result = rec ? _fromRecord(rec) : { found: false };
    if (result.found) return result;
    logger.info({ lrclib_id: pickedId, title: track.title }, 'Picked LRCLIB version gone, choosing again');
  }
  return _fetchFromLrclib(track);
}

function _lrclib(trackId, track, pickedId = null) {
  const memo = _memo.get(trackId);
  if (memo && memo.expires > Date.now()) return Promise.resolve(memo.result);
  if (_inFlight.has(trackId)) return _inFlight.get(trackId);

  const promise = _fetchChosenOrBest(track, pickedId)
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
  // "Retry": forget a remembered miss or error and ask LRCLIB again, skipped servers included.
  if (refresh) {
    _memo.delete(trackId);
    lrclibClient.clearCooldowns();
  }
  const prefs = lyricsPrefs.get(trackId);
  const base = { track_id: trackId, lrclib_id: prefs.lrclib_id ?? null, offset_ms: prefs.offset_ms || 0 };
  // "Wrong lyrics": the user said what this track gets is wrong (LRCLIB can hold another
  // song's words) — show none, whatever the source, until they undo it or pick other lyrics.
  if (prefs.wrong) {
    return { ...base, found: false, source: null, text: null, synced: false, instrumental: false, marked_wrong: true };
  }

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

  const remote = await _lrclib(trackId, track, prefs.lrclib_id);
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
  const prefs = lyricsPrefs.set(trackId, { lrclib_id: rec.id ?? lrclibId, wrong: null });
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
  lyricsPrefs.set(trackId, { lrclib_id: null, offset_ms: null, wrong: null });
  _memo.delete(trackId);
  return { ..._fromText(text), source: 'cache', track_id: trackId, lrclib_id: null, offset_ms: 0 };
}

/**
 * Mark the lyrics this track gets as wrong (none shown from now on), or undo it.
 * The cached copy is kept, so undoing shows it again at once. A picked LRCLIB version is
 * forgotten when marking: it is the one that was wrong.
 * @param {{ title, artist, album }} track
 * @param {boolean} wrong
 */
function markWrong(track, wrong) {
  const trackId = _trackId(track);
  lyricsPrefs.set(trackId, wrong ? { wrong: true, lrclib_id: null } : { wrong: null });
  return { track_id: trackId, marked_wrong: !!wrong };
}

/**
 * What is already known about a track's lyrics, without reading files or asking LRCLIB:
 * the metadata cache, then a remembered LRCLIB answer.
 * @param {{ title, artist, album }} track
 * @returns {'synced'|'plain'|'instrumental'|'none'|'unknown'} 'unknown' also after an error
 */
function peek(track) {
  if (!track || !track.title || !track.artist) return 'unknown';
  if (lyricsPrefs.get(_trackId(track)).wrong) return 'none';
  const cached = lrcCache.getByMeta(track.artist, track.title, track.album);
  if (cached) return isSynced(cached) ? 'synced' : 'plain';
  const memo = _memo.get(_trackId(track));
  if (!memo || memo.expires <= Date.now() || memo.result.error) return 'unknown';
  return memo.result.instrumental ? 'instrumental' : 'none';
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

module.exports = {
  resolve, peek, choose, setOffset, saveCustom, markWrong, lookupLrclib, isSynced, pickHit, rankHits, simplify, _resetMemo,
};
