'use strict';

const fs = require('fs');
const path = require('path');
const NodeID3 = require('node-id3');
const flacTagger = require('./flacTagger');
const logger = require('../utils/logger');
const { AppError, E } = require('../utils/normalize');

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.flac']);
const BACKUP_SUFFIX = '.org';

/**
 * @typedef {Object} BackupOptions
 * @property {boolean} enabled            Whether to create a `.org` backup before writing.
 * @property {'ask'|'keep'|'overwrite'} [onConflict]
 *           What to do when the backup already exists. The route layer
 *           translates "ask" into a 409 to the frontend; the embedder itself
 *           treats "ask" as a no-op error (BACKUP_EXISTS) so the user can
 *           decide.
 */

/**
 * Compute the absolute backup path for an audio file.
 * Example: /music/Song.flac → /music/Song.flac.org
 */
function getBackupPath(audioPath) {
  return audioPath + BACKUP_SUFFIX;
}

function backupExists(audioPath) {
  return fs.existsSync(getBackupPath(audioPath));
}

/**
 * Copy `src` → `dest`. Uses fs.copyFileSync which is atomic enough for our
 * needs and preserves byte-for-byte content. We do NOT touch metadata of the
 * backup file beyond standard fs flags.
 */
function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

/**
 * Write the LRC content into the audio file's LYRICS tag.
 *  - MP3  → ID3v2 USLT frame, descriptor "LYRICS"
 *  - FLAC → Vorbis comment LYRICS (existing LYRICS, if any, is renamed to
 *           LYRICS.ORG; LYRICS.ORG is overwritten on conflict). All other
 *           tags AND picture/seektable/cuesheet blocks are preserved.
 *  - WAV / others → throws LYRICS_EMBED_UNSUPPORTED.
 *
 * @param {string} audioPath
 * @param {string} lrcContent
 * @param {{ backup?: BackupOptions }} [options]
 * @returns {{ format: 'mp3'|'flac', bytes: number, backup_path: string|null, backup_created: boolean }}
 */
function embedLyrics(audioPath, lrcContent, options = {}) {
  if (typeof lrcContent !== 'string' || lrcContent.length === 0) {
    throw new AppError(E.LYRICS_EMBED_FAILED, 'LRC content is empty');
  }
  if (!fs.existsSync(audioPath)) {
    throw new AppError(E.SOURCE_FILE_NOT_FOUND, `File not found: ${audioPath}`);
  }
  const ext = path.extname(audioPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new AppError(
      E.LYRICS_EMBED_UNSUPPORTED,
      `Embedding is not supported for "${ext}" files`
    );
  }

  // ── Backup phase ─────────────────────────────────────────────────────────
  const backup = options.backup || { enabled: false };
  let backupCreated = false;
  let backupPath = null;
  if (backup.enabled) {
    backupPath = getBackupPath(audioPath);
    const exists = fs.existsSync(backupPath);
    if (exists) {
      const conflict = backup.onConflict || 'ask';
      if (conflict === 'ask') {
        throw new AppError(
          E.BACKUP_EXISTS,
          `Backup file already exists: ${backupPath}`,
          { backup_path: backupPath }
        );
      }
      if (conflict === 'keep') {
        // Use the existing backup as-is, don't overwrite.
        logger.info({ audioPath, backupPath }, 'Backup already exists — keeping it');
      } else if (conflict === 'overwrite') {
        copyFile(audioPath, backupPath);
        backupCreated = true;
        logger.info({ audioPath, backupPath }, 'Backup overwritten with current file');
      } else {
        throw new AppError(E.LYRICS_EMBED_FAILED, `Unknown backup conflict mode "${conflict}"`);
      }
    } else {
      copyFile(audioPath, backupPath);
      backupCreated = true;
      logger.info({ audioPath, backupPath }, 'Backup created before embedding');
    }
  }

  // ── Embed phase ──────────────────────────────────────────────────────────
  let result;
  try {
    if (ext === '.mp3') {
      result = embedMp3(audioPath, lrcContent);
    } else {
      result = embedFlac(audioPath, lrcContent);
    }
  } catch (err) {
    // If we created a fresh backup but the embed itself failed, restore the
    // file from backup so the user is not left with a broken file. We only
    // restore when WE just created the backup in this call — never overwrite
    // an existing/older backup with the (potentially mid-write) live file.
    if (backupCreated && backupPath && fs.existsSync(backupPath)) {
      try {
        copyFile(backupPath, audioPath);
        logger.warn({ audioPath, err: err.message }, 'Embed failed — restored from fresh backup');
      } catch (restoreErr) {
        logger.error({ audioPath, err: restoreErr.message }, 'Failed to restore backup after embed failure');
      }
    }
    throw err;
  }

  return { ...result, backup_path: backupPath, backup_created: backupCreated };
}

function embedMp3(audioPath, lrcContent) {
  // node-id3.update() is a partial update — it merges the supplied frames
  // with whatever already exists in the file, so other tags (artist, album,
  // pictures, …) are preserved.
  const tags = {
    unsynchronisedLyrics: {
      language: 'eng',
      shortText: 'LYRICS',
      text: lrcContent,
    },
  };
  const ok = NodeID3.update(tags, audioPath);
  if (ok !== true) {
    const message = ok && ok.message ? ok.message : 'node-id3 update failed';
    throw new AppError(E.LYRICS_EMBED_FAILED, `MP3 embed failed: ${message}`);
  }
  logger.info({ audioPath, length: lrcContent.length }, 'Embedded LYRICS into MP3 (USLT)');
  return { format: 'mp3', bytes: lrcContent.length };
}

function embedFlac(audioPath, lrcContent) {
  let summary;
  try {
    summary = flacTagger.setLyrics(audioPath, lrcContent);
  } catch (err) {
    throw new AppError(E.LYRICS_EMBED_FAILED, `FLAC embed failed: ${err.message}`);
  }
  logger.info(
    {
      audioPath,
      length: lrcContent.length,
      tags_before: summary.tagCountBefore,
      tags_after: summary.tagCountAfter,
      had_existing_lyrics: summary.hadExistingLyrics,
    },
    'Embedded LYRICS into FLAC (Vorbis comment)'
  );
  return { format: 'flac', bytes: lrcContent.length };
}

/**
 * @param {string} audioPath
 * @returns {boolean}
 */
function canEmbed(audioPath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(audioPath).toLowerCase());
}

module.exports = {
  embedLyrics,
  removeLyrics,
  canEmbed,
  getBackupPath,
  backupExists,
  SUPPORTED_EXTENSIONS,
  BACKUP_SUFFIX,
};

/**
 * Remove embedded lyrics from an audio file.
 *  - FLAC: removes LYRICS (and LYRICS.ORG) vorbis comment tags.
 *  - MP3:  removes the USLT (unsynchronised lyrics) ID3 frame.
 *
 * @param {string} audioPath
 * @returns {{ format: 'mp3'|'flac', removed: boolean }}
 */
function removeLyrics(audioPath) {
  if (!fs.existsSync(audioPath)) {
    throw new AppError(E.SOURCE_FILE_NOT_FOUND, `File not found: ${audioPath}`);
  }
  const ext = path.extname(audioPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new AppError(E.LYRICS_EMBED_UNSUPPORTED, `Unsupported format for lyrics removal: ${ext}`);
  }

  if (ext === '.flac') {
    const result = flacTagger.removeLyrics(audioPath);
    logger.info({ audioPath, removed: result.removed }, 'removeLyrics: FLAC');
    return { format: 'flac', ...result };
  }

  // MP3: read all tags, delete the USLT frame, re-write everything else.
  const currentTags = NodeID3.read(audioPath);
  if (!currentTags.unsynchronisedLyrics) {
    return { format: 'mp3', removed: false };
  }
  delete currentTags.unsynchronisedLyrics;
  const ok = NodeID3.write(currentTags, audioPath);
  if (ok !== true) {
    throw new AppError(E.LYRICS_EMBED_FAILED, `MP3 lyrics removal failed: ${ok?.message || 'unknown'}`);
  }
  logger.info({ audioPath }, 'removeLyrics: MP3 USLT removed');
  return { format: 'mp3', removed: true };
}

