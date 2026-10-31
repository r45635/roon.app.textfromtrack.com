'use strict';

const fs = require('fs');
const logger = require('../utils/logger');
const userSettings = require('../settings/userSettings');
const lyricsEmbedder = require('./lyricsEmbedder');
const lyricsDetector = require('./lyricsDetector');

/**
 * Write lyrics into a local audio file the way the user configured it (Files Management
 * defaults, overridable by `flags`): a .lrc sidecar and/or embedded tags. A save must write
 * somewhere: with both off, it embeds when the format allows it, else writes the sidecar.
 *
 * The caller has already checked that `audioPath` is resolved, under a music root and exists.
 *
 * @param {string} audioPath
 * @param {string} lrc
 * @param {object} [flags] optional { embed, backup, save_beside }
 * @returns {{ lrc_file: string|null, lyrics_embedded: boolean, backup_path: string|null, status: string }}
 *   status = the lyrics_status the index should now hold
 */
function writeLyricsToFile(audioPath, lrc, flags) {
  let { embed, backup, saveBeside } = userSettings.resolveWriteFlags(flags);
  if (!embed && !saveBeside) {
    if (lyricsEmbedder.canEmbed(audioPath)) embed = true;
    else saveBeside = true;
  }

  const result = { lrc_file: null, lyrics_embedded: false, backup_path: null, status: null };

  if (saveBeside) {
    const lrcPath = lyricsDetector.getLrcPath(audioPath);
    fs.writeFileSync(lrcPath, lrc, 'utf8');
    result.lrc_file = lrcPath;
    logger.info({ lrcPath }, 'LRC sidecar written');
  }

  if (embed) {
    const embedResult = lyricsEmbedder.embedLyrics(audioPath, lrc, {
      backup: { enabled: backup, onConflict: 'overwrite' },
    });
    result.lyrics_embedded = true;
    result.backup_path = embedResult.backup_path || null;
    logger.info({ audioPath }, 'Lyrics embedded');
  }

  result.status = embed ? lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS : lyricsDetector.STATUS.HAS_LRC_FILE;
  return result;
}

module.exports = { writeLyricsToFile };
