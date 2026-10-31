'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { writeJson, readJson } = require('../utils/fileUtils');
const lyricsDetector = require('./lyricsDetector');
const userSettings = require('../settings/userSettings');

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aiff', '.aif', '.m4a']);

// The library often sits on a NAS or a USB drive that can stall for a minute while it
// wakes up: every file access here is async, so a stalled drive never freezes the server
// (UI, API and the Roon connection keep running while the scan waits).

async function exists(p) {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

// ─── Recursive directory walker ───────────────────────────────────────────────

async function* walkDir(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    logger.warn({ dir, err: err.message }, 'Cannot read directory — skipping');
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full);
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      // Skip macOS AppleDouble resource fork files (._filename)
      if (entry.name.startsWith('._')) continue;
      yield full;
    }
  }
}

// ─── Single-file metadata extraction ─────────────────────────────────────────

async function extractTrack(filePath, parseFile) {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    logger.warn({ filePath, err: err.message }, 'Cannot stat file — skipping');
    return null;
  }

  let metadata;
  try {
    metadata = await parseFile(filePath, { skipCovers: true, duration: true });
  } catch (err) {
    logger.warn({ filePath, err: err.message }, 'Cannot parse metadata — skipping');
    return null;
  }

  const { common, format } = metadata;
  const lrcPath = lyricsDetector.getLrcPath(filePath);
  const lyricsStatus = lyricsDetector.detectFromMetadata(filePath, common, await exists(lrcPath));

  return {
    path: filePath,
    filename,
    extension: ext,
    title: common.title || null,
    artist: (common.artists && common.artists[0]) || common.artist || null,
    album: common.album || null,
    albumartist: common.albumartist || null,
    track_number: (common.track && common.track.no) || null,
    disc_number: (common.disk && common.disk.no) || null,
    duration_seconds: format.duration ? Math.round(format.duration * 10) / 10 : null,
    sample_rate_hz: format.sampleRate || null,
    bits_per_sample: format.bitsPerSample || null,
    lossless: format.lossless ?? null,
    codec: format.codec || null,
    has_embedded_lyrics: lyricsStatus === lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS,
    has_lrc_file: lyricsStatus === lyricsDetector.STATUS.HAS_LRC_FILE,
    lrc_path: lrcPath,
    lyrics_status: lyricsStatus,
    last_modified: stat.mtime.toISOString(),
    size_bytes: stat.size,
    isrc: common.isrc || null,
    musicbrainz_trackid: (common.musicbrainz && common.musicbrainz.trackId) || null,
  };
}

// ─── Main scan entry point ────────────────────────────────────────────────────

let _scanInProgress = false;
// Live progress of the running scan, and the outcome of the last one (for the settings UI).
let _progress = { scanned: 0, errors: 0, started_at: null };
let _lastScan = { error: null, missing_roots: [], error_count: 0 };

/**
 * Scan all configured MUSIC_ROOTS and write the result to music-index.json.
 * @param {{ onProgress?: (scanned: number, errors: number) => void }} [opts]
 * @returns {Promise<{ track_count: number, error_count: number, elapsed_ms: number }>}
 */
async function scan(opts = {}) {
  if (_scanInProgress) throw new Error('A scan is already in progress');
  _scanInProgress = true;
  _progress = { scanned: 0, errors: 0, started_at: new Date().toISOString() };
  try {
    const result = await _scan(opts);
    _lastScan = { error: null, missing_roots: result.missing_roots, error_count: result.error_count };
    return result;
  } catch (err) {
    _lastScan = { error: err.message, missing_roots: [], error_count: _progress.errors };
    throw err;
  } finally {
    _scanInProgress = false;
  }
}

async function _scan(opts) {
  const start = Date.now();

  const { onProgress } = opts;
  const settings = userSettings.get();
  const roots = settings.music_roots.length ? settings.music_roots : config.musicRoots;

  if (!roots.length) {
    logger.warn('MUSIC_ROOTS is not configured — nothing to scan');
    return { track_count: 0, error_count: 0, elapsed_ms: 0, missing_roots: [] };
  }

  logger.info({ roots }, 'Starting music library scan');

  // Lazy-load music-metadata (ESM-only package, imported from CJS via dynamic import)
  const { parseFile } = await import('music-metadata');

  const tracks = [];
  let errorCount = 0;
  let scannedCount = 0;

  const missingRoots = [];
  for (const root of roots) {
    if (!(await exists(root))) {
      logger.warn({ root }, 'Music root does not exist — skipping');
      missingRoots.push(root);
      continue;
    }
    for await (const filePath of walkDir(root)) {
      const track = await extractTrack(filePath, parseFile);
      if (track) {
        tracks.push(track);
      } else {
        errorCount++;
      }
      scannedCount++;
      _progress.scanned = scannedCount;
      _progress.errors = errorCount;
      if (onProgress && scannedCount % 100 === 0) {
        onProgress(scannedCount, errorCount);
      }
    }
  }

  // Every root missing (NAS unmounted, drive asleep): keep the previous index rather
  // than replacing it with an empty one.
  if (missingRoots.length === roots.length) {
    throw new Error(`No music folder is reachable: ${missingRoots.join(', ')}`);
  }

  const index = {
    version: 1,
    last_scan_at: new Date().toISOString(),
    track_count: tracks.length,
    music_roots: roots,
    tracks,
  };

  writeJson(config.musicIndexPath, index);

  const elapsed = Date.now() - start;
  logger.info(
    { track_count: tracks.length, error_count: errorCount, elapsed_ms: elapsed },
    'Music library scan complete'
  );

  return { track_count: tracks.length, error_count: errorCount, elapsed_ms: elapsed, missing_roots: missingRoots };
}

const EMPTY_INDEX = { version: 1, last_scan_at: null, track_count: 0, music_roots: [], tracks: [] };

// Parsed index kept in memory, reloaded only when the file changes on disk — a large
// library's JSON is tens of MB and is read on every track change.
let _cache = { mtimeMs: -1, path: null, index: null };

/**
 * Read the current music index (from memory when the file is unchanged).
 * Callers must not mutate the returned object; use updateTracksLyricsStatus to change it.
 */
function loadIndex() {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(config.musicIndexPath).mtimeMs;
  } catch {
    return { ...EMPTY_INDEX, tracks: [] };
  }
  if (_cache.index && _cache.mtimeMs === mtimeMs && _cache.path === config.musicIndexPath) return _cache.index;
  const index = readJson(config.musicIndexPath, null) || { ...EMPTY_INDEX, tracks: [] };
  _cache = { mtimeMs, path: config.musicIndexPath, index };
  return index;
}

/**
 * Update the lyrics_status of several tracks with a single index write.
 * @param {Array<{ path: string, status: string }>} updates
 * @returns {number} how many tracks were found and updated
 */
function updateTracksLyricsStatus(updates) {
  if (!updates.length) return 0;
  const index = readJson(config.musicIndexPath, null);
  if (!index) return 0;
  const byPath = new Map(updates.map(u => [u.path, u.status]));
  let changed = 0;
  for (const track of index.tracks) {
    if (!byPath.has(track.path)) continue;
    const status = byPath.get(track.path);
    track.lyrics_status = status;
    track.has_lrc_file = status === lyricsDetector.STATUS.HAS_LRC_FILE;
    track.has_embedded_lyrics = status === lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS;
    changed++;
  }
  if (changed) writeJson(config.musicIndexPath, index);
  return changed;
}

/**
 * Update a single track's lyrics_status inside the persisted index.
 * @param {string} filePath
 * @param {string} lyricsStatus
 */
function updateTrackLyricsStatus(filePath, lyricsStatus) {
  updateTracksLyricsStatus([{ path: filePath, status: lyricsStatus }]);
}

function isScanInProgress() {
  return _scanInProgress;
}

/** Progress of the running scan and outcome of the last one. */
function getScanState() {
  return { in_progress: _scanInProgress, progress: { ..._progress }, last: { ..._lastScan } };
}

module.exports = {
  scan, loadIndex, updateTrackLyricsStatus, updateTracksLyricsStatus, isScanInProgress, getScanState,
};
