'use strict';

const fs = require('fs');
const path = require('path');

// ─── Lyrics status constants ──────────────────────────────────────────────────

const STATUS = {
  HAS_LRC_FILE: 'HAS_LRC_FILE',
  HAS_EMBEDDED_LYRICS: 'HAS_EMBEDDED_LYRICS',
  HAS_CACHED_LYRICS: 'HAS_CACHED_LYRICS',
  NO_LOCAL_LYRICS: 'NO_LOCAL_LYRICS',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Return the expected .lrc sidecar path for an audio file.
 * @param {string} audioPath
 * @returns {string}
 */
function getLrcPath(audioPath) {
  const ext = path.extname(audioPath);
  return audioPath.slice(0, -ext.length) + '.lrc';
}

/**
 * Return true if a .lrc sidecar file exists for the given audio path.
 * @param {string} audioPath
 */
function hasLrcFile(audioPath) {
  return fs.existsSync(getLrcPath(audioPath));
}

/**
 * Return true if the music-metadata `common` object contains embedded lyrics.
 * @param {object} common  - The `metadata.common` object from music-metadata
 */
function hasEmbeddedLyrics(common) {
  if (!common || !common.lyrics) return false;
  const lyrics = common.lyrics;
  if (!Array.isArray(lyrics)) return false;
  return lyrics.some(l => {
    if (!l) return false;
    if (typeof l === 'string') return l.length > 0;
    // music-metadata may return objects with { text: string }
    return typeof l.text === 'string' && l.text.length > 0;
  });
}

/**
 * Detect lyrics status from a pre-parsed metadata `common` object.
 * Avoids re-reading the file during a scan.
 *
 * @param {string} audioPath
 * @param {object} common - metadata.common from music-metadata
 * @returns {string} One of the STATUS constants
 */
function detectFromMetadata(audioPath, common) {
  try {
    if (hasLrcFile(audioPath)) return STATUS.HAS_LRC_FILE;
    if (hasEmbeddedLyrics(common)) return STATUS.HAS_EMBEDDED_LYRICS;
    return STATUS.NO_LOCAL_LYRICS;
  } catch {
    return STATUS.UNKNOWN;
  }
}

/**
 * Full detection: read the file and check both sidecar and embedded lyrics.
 * @param {string} audioPath
 * @returns {Promise<string>} One of the STATUS constants
 */
async function detect(audioPath) {
  try {
    if (!fs.existsSync(audioPath)) return STATUS.UNKNOWN;
    if (hasLrcFile(audioPath)) return STATUS.HAS_LRC_FILE;

    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(audioPath, { skipCovers: true });
    if (hasEmbeddedLyrics(metadata.common)) return STATUS.HAS_EMBEDDED_LYRICS;
    return STATUS.NO_LOCAL_LYRICS;
  } catch {
    return STATUS.UNKNOWN;
  }
}

module.exports = { STATUS, detect, detectFromMetadata, hasLrcFile, hasEmbeddedLyrics, getLrcPath };
