'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { writeJson, readJson } = require('../utils/fileUtils');
const lyricsDetector = require('./lyricsDetector');
const userSettings = require('../storage/userSettings');

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aiff', '.aif', '.m4a']);

// ─── Recursive directory walker ───────────────────────────────────────────────

function* walkDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
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
    stat = fs.statSync(filePath);
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
  const lyricsStatus = lyricsDetector.detectFromMetadata(filePath, common);
  const lrcPath = lyricsDetector.getLrcPath(filePath);

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

/**
 * Scan all configured MUSIC_ROOTS and write the result to music-index.json.
 * @param {{ onProgress?: (scanned: number, errors: number) => void }} [opts]
 * @returns {Promise<{ track_count: number, error_count: number, elapsed_ms: number }>}
 */
async function scan(opts = {}) {
  if (_scanInProgress) throw new Error('A scan is already in progress');
  _scanInProgress = true;
  const start = Date.now();

  const { onProgress } = opts;
  const settings = userSettings.get();
  const roots = settings.music_roots.length ? settings.music_roots : config.musicRoots;

  if (!roots.length) {
    _scanInProgress = false;
    logger.warn('MUSIC_ROOTS is not configured — nothing to scan');
    return { track_count: 0, error_count: 0, elapsed_ms: 0 };
  }

  logger.info({ roots }, 'Starting music library scan');

  // Lazy-load music-metadata (ESM-only package, imported from CJS via dynamic import)
  const { parseFile } = await import('music-metadata');

  const tracks = [];
  let errorCount = 0;
  let scannedCount = 0;

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      logger.warn({ root }, 'Music root does not exist — skipping');
      continue;
    }
    for (const filePath of walkDir(root)) {
      const track = await extractTrack(filePath, parseFile);
      if (track) {
        tracks.push(track);
      } else {
        errorCount++;
      }
      scannedCount++;
      if (onProgress && scannedCount % 100 === 0) {
        onProgress(scannedCount, errorCount);
      }
    }
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

  _scanInProgress = false;
  return { track_count: tracks.length, error_count: errorCount, elapsed_ms: elapsed };
}

/**
 * Read the current music index from disk.
 */
function loadIndex() {
  return readJson(config.musicIndexPath, {
    version: 1,
    last_scan_at: null,
    track_count: 0,
    music_roots: [],
    tracks: [],
  });
}

/**
 * Update a single track's lyrics_status inside the persisted index.
 * @param {string} filePath
 * @param {string} lyricsStatus
 */
function updateTrackLyricsStatus(filePath, lyricsStatus) {
  const index = loadIndex();
  const track = index.tracks.find(t => t.path === filePath);
  if (track) {
    track.lyrics_status = lyricsStatus;
    track.has_lrc_file = lyricsStatus === lyricsDetector.STATUS.HAS_LRC_FILE;
    writeJson(config.musicIndexPath, index);
  }
}

function isScanInProgress() {
  return _scanInProgress;
}

module.exports = { scan, loadIndex, updateTrackLyricsStatus, isScanInProgress };
