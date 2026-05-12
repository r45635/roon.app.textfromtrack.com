'use strict';

const { normalizeStr, normalizeArtist, normalizeAlbum } = require('../utils/normalize');

// ─── Confidence thresholds ────────────────────────────────────────────────────

const CONFIDENCE_HIGH = 90;
const CONFIDENCE_MEDIUM = 60;
const CONFIDENCE_LOW = 35;

// ─── M4: Levenshtein distance + string similarity ────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 * Uses a memory-optimised single-row DP.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // dp[i] = edit distance between a[0..i] and b[0..j] (rolling)
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = j;
    for (let i = 1; i <= m; i++) {
      const val = a[i - 1] === b[j - 1]
        ? dp[i - 1]
        : Math.min(dp[i - 1], dp[i], prev) + 1;
      dp[i - 1] = prev;
      prev = val;
    }
    dp[m] = prev;
  }
  return dp[m];
}

/**
 * Normalised similarity score in [0, 1].
 * 1 = identical, 0 = completely different.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Score the title field (max 50).
 *
 * - Exact match                  → 50
 * - Fuzzy similarity ≥ 0.85      → 35
 * - Fuzzy similarity ≥ 0.70      → 20
 * - Below 0.70                   →  0
 *
 * @returns {{ points: number, max: number, method: string }}
 */
function _scoreTitle(rNorm, tNorm) {
  if (!rNorm || !tNorm) return { points: 0, max: 50, method: 'missing' };
  if (rNorm === tNorm) return { points: 50, max: 50, method: 'exact' };
  const sim = similarity(rNorm, tNorm);
  if (sim >= 0.85) return { points: 35, max: 50, method: 'fuzzy' };
  if (sim >= 0.70) return { points: 20, max: 50, method: 'fuzzy' };
  return { points: 0, max: 50, method: 'no' };
}

/**
 * Score the artist field (max 30, M2: feat-stripped + fuzzy).
 *
 * - Exact match (after feat-strip) → 30
 * - Fuzzy similarity ≥ 0.85        → 21
 * - Fuzzy similarity ≥ 0.70        → 12
 * - Below 0.70                     →  0
 *
 * @returns {{ points: number, max: number, method: string }}
 */
function _scoreArtist(rNorm, tNorm) {
  if (!rNorm || !tNorm) return { points: 0, max: 30, method: 'missing' };
  if (rNorm === tNorm) return { points: 30, max: 30, method: 'exact' };
  const sim = similarity(rNorm, tNorm);
  if (sim >= 0.85) return { points: 21, max: 30, method: 'fuzzy' };
  if (sim >= 0.70) return { points: 12, max: 30, method: 'fuzzy' };
  return { points: 0, max: 30, method: 'no' };
}

/**
 * Score the album field (max 20, M3: edition-suffix-stripped + fuzzy).
 *
 * - Exact match (after suffix-strip) → 20
 * - Fuzzy similarity ≥ 0.80          → 14
 * - Below 0.80                       →  0
 *
 * @returns {{ points: number, max: number, method: string }}
 */
function _scoreAlbum(rNorm, tNorm) {
  if (!rNorm || !tNorm) return { points: 0, max: 20, method: 'missing' };
  if (rNorm === tNorm) return { points: 20, max: 20, method: 'exact' };
  const sim = similarity(rNorm, tNorm);
  if (sim >= 0.80) return { points: 14, max: 20, method: 'fuzzy' };
  return { points: 0, max: 20, method: 'no' };
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

/**
 * Score a single index track against the Roon now-playing metadata.
 *
 * Scoring table:
 *   ISRC exact match (M6)                +60  (short-circuits other ISRC logic)
 *   Exact normalised title match         +50  (M4: fuzzy fallback 35/20)
 *   Exact normalised artist match (M2)   +30  (feat-stripped; M4: fuzzy 21/12)
 *   Exact normalised album match (M3)    +20  (suffix-stripped; M4: fuzzy 14)
 *   Duration delta < 2 s                 +20
 *   Duration delta < 5 s                 +10
 *   Filename contains title              +10
 *
 *   Max without ISRC: 130
 *   Max with ISRC:    190
 *
 * @param {{ title, artist, album, duration_seconds, isrc }} roon
 * @param {{ title, artist, album, duration_seconds, filename, isrc }} track
 * @returns {{ total: number, detail: object }}
 */
function scoreTrack(roon, track) {
  const detail = {
    title:    { points: 0, max: 50,  method: 'missing' },
    artist:   { points: 0, max: 30,  method: 'missing' },
    album:    { points: 0, max: 20,  method: 'missing' },
    duration: { points: 0, max: 20,  method: 'no' },
    filename: { points: 0, max: 10,  method: 'no' },
    isrc:     { points: 0, max: 60,  method: 'no' },
  };

  // M6: ISRC exact match (strongest possible signal)
  if (roon.isrc && track.isrc && roon.isrc === track.isrc) {
    detail.isrc = { points: 60, max: 60, method: 'match' };
  }

  // Title (M4 fuzzy, normalizeStr)
  const rTitle = normalizeStr(roon.title);
  const tTitle = normalizeStr(track.title);
  detail.title = _scoreTitle(rTitle, tTitle);

  // Artist (M2 feat-strip, M4 fuzzy)
  const rArtist = normalizeArtist(roon.artist);
  const tArtist = normalizeArtist(track.artist);
  detail.artist = _scoreArtist(rArtist, tArtist);

  // Album (M3 suffix-strip, M4 fuzzy)
  const rAlbum = normalizeAlbum(roon.album);
  const tAlbum = normalizeAlbum(track.album);
  detail.album = _scoreAlbum(rAlbum, tAlbum);

  // Duration
  const rDur = roon.duration_seconds;
  const tDur = track.duration_seconds;
  if (rDur && tDur) {
    const delta = Math.abs(rDur - tDur);
    if (delta < 2) {
      detail.duration = { points: 20, max: 20, method: '<2s' };
    } else if (delta < 5) {
      detail.duration = { points: 10, max: 20, method: '<5s' };
    }
  }

  // Filename fallback
  if (rTitle && track.filename) {
    const fn = normalizeStr(track.filename);
    if (fn.includes(rTitle)) {
      detail.filename = { points: 10, max: 10, method: 'match' };
    }
  }

  const total = Object.values(detail).reduce((sum, d) => sum + d.points, 0);
  return { total, detail };
}

/**
 * Convert a numeric score to a confidence string.
 * @param {number} score
 * @returns {'high'|'medium'|'low'|'none'}
 */
function scoreToConfidence(score) {
  if (score >= CONFIDENCE_HIGH) return 'high';
  if (score >= CONFIDENCE_MEDIUM) return 'medium';
  if (score >= CONFIDENCE_LOW) return 'low';
  return 'none';
}

/**
 * Match Roon now-playing metadata against the local music index.
 *
 * @param {{ title, artist, album, duration_seconds, isrc }} roonTrack
 * @param {Array<object>} indexTracks  - Array from music-index.json
 * @returns {{
 *   matched: boolean,
 *   confidence: 'high'|'medium'|'low'|'none',
 *   score: number,
 *   score_detail: object,
 *   track: object|null,
 *   alternatives: Array<object>
 * }}
 */
function match(roonTrack, indexTracks) {
  if (!indexTracks || !indexTracks.length) {
    return { matched: false, confidence: 'none', score: 0, score_detail: null, track: null, alternatives: [] };
  }

  // Score all tracks
  const scored = indexTracks
    .map(t => {
      const { total, detail } = scoreTrack(roonTrack, t);
      return { track: t, score: total, detail };
    })
    .filter(c => c.score >= CONFIDENCE_LOW)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { matched: false, confidence: 'none', score: 0, score_detail: null, track: null, alternatives: [] };
  }

  const best = scored[0];
  const confidence = scoreToConfidence(best.score);

  // Alternatives: other candidates with score >= LOW but not the best
  const alternatives = scored
    .slice(1, 6) // up to 5 alternatives
    .map(c => ({
      path: c.track.path,
      title: c.track.title,
      artist: c.track.artist,
      album: c.track.album,
      score: c.score,
      confidence: scoreToConfidence(c.score),
      lyrics_status: c.track.lyrics_status,
      sample_rate_hz: c.track.sample_rate_hz,
      bits_per_sample: c.track.bits_per_sample,
      lossless: c.track.lossless,
      duration_seconds: c.track.duration_seconds,
      size_bytes: c.track.size_bytes,
    }));

  return {
    matched: confidence !== 'none',
    confidence,
    score: best.score,
    score_detail: best.detail,
    track: best.track,
    alternatives,
  };
}

module.exports = { match, scoreTrack, scoreToConfidence };
