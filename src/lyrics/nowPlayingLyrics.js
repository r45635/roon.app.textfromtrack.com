'use strict';

/**
 * Lyrics of what a Roon zone is playing: finds the matching local file when a music folder is
 * configured (only high/medium confidence: a wrong file would show wrong lyrics), then resolves.
 * Also prefetches on every track change so lyrics are ready before a viewer asks.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const scanner = require('../music/scanner');
const matcher = require('../music/matcher');
const musicRoots = require('../music/musicRoots');
const lyricsWriter = require('../music/lyricsWriter');
const userSettings = require('../storage/userSettings');
const jobStore = require('../textfromtrack/jobStore');
const lyricsResolver = require('./lyricsResolver');

const MATCH_MEMO_TTL_MS = 30 * 1000;
const _matchMemo = new Map(); // track key -> { path, expires }

function trackKey(np) {
  return `${np.title || ''}||${np.artist || ''}||${np.album || ''}||${np.duration_seconds || ''}`;
}

/**
 * Path of the local file matching a now-playing item, or null (no library, no or weak match).
 * @param {object} np now-playing state
 */
function findLocalFile(np) {
  if (!musicRoots.getMusicRoots().length) return null;
  const key = trackKey(np);
  const memo = _matchMemo.get(key);
  if (memo && memo.expires > Date.now()) return memo.path;

  let found = null;
  const index = scanner.loadIndex();
  if (index.tracks.length) {
    const result = matcher.match(np, index.tracks);
    if (result.matched && (result.confidence === 'high' || result.confidence === 'medium')) {
      const resolved = path.resolve(result.track.path);
      if (musicRoots.isUnderMusicRoot(resolved) && fs.existsSync(resolved)) found = resolved;
    }
  }
  if (_matchMemo.size > 200) _matchMemo.clear();
  _matchMemo.set(key, { path: found, expires: Date.now() + MATCH_MEMO_TTL_MS });
  return found;
}

/**
 * @param {object} np now-playing state
 * @param {{ audioPath?: string|null, refresh?: boolean }} [opts] a file the viewer picked
 *   (omitted = auto-match); refresh = ask LRCLIB again even after a recent miss or error
 * @returns {Promise<{ lyrics: object, audioPath: string|null }>}
 */
async function lyricsForNowPlaying(np, opts = {}) {
  const audioPath = opts.audioPath !== undefined ? opts.audioPath : findLocalFile(np);
  const lyrics = await lyricsResolver.resolve(np, { audioPath, refresh: !!opts.refresh });
  return { lyrics, audioPath };
}

/**
 * "Save LRCLIB lyrics automatically": the playing track matched a local file that has no
 * lyrics (resolve fell through to the cache or LRCLIB) and the lyrics are synced → write them.
 * @returns {boolean} whether lyrics were written
 */
function autoSave(np, lyrics, audioPath) {
  if (!userSettings.get().auto_save_lrclib) return false;
  if (!audioPath || !lyrics.found || !lyrics.synced || !lyrics.text) return false;
  if (lyrics.source !== 'lrclib' && lyrics.source !== 'cache') return false;
  const written = lyricsWriter.writeLyricsToFile(audioPath, lyrics.text);
  scanner.updateTrackLyricsStatus(audioPath, written.status);
  jobStore.recordLyricsSave({
    sourceFile: audioPath, lrc: lyrics.text, title: np.title, artist: np.artist, album: np.album,
    written, auto: true,
  });
  logger.info({ audioPath, embedded: written.lyrics_embedded }, 'LRCLIB lyrics saved automatically');
  return true;
}

/**
 * Prefetch lyrics whenever a zone starts playing a new track (and auto-save them if enabled).
 * @param {{ events: import('events').EventEmitter, getNowPlaying: Function }} roon
 */
function watchRoon(roon) {
  const lastKeyByZone = new Map();
  roon.events.on('zones_changed', (zoneIds) => {
    for (const zoneId of zoneIds) {
      const np = roon.getNowPlaying(zoneId);
      if (!np || np.state !== 'playing' || !np.title || !np.artist) continue;
      const key = trackKey(np);
      if (lastKeyByZone.get(zoneId) === key) continue;
      lastKeyByZone.set(zoneId, key);
      lyricsForNowPlaying(np)
        .then(({ lyrics, audioPath }) => {
          logger.debug(
            { zone: np.zone_name, title: np.title, source: lyrics.source, found: lyrics.found },
            'Lyrics prefetched'
          );
          try {
            autoSave(np, lyrics, audioPath);
          } catch (err) {
            logger.warn({ err: err.message, audioPath }, 'Automatic lyrics save failed');
            // Visible in Job History, not only in the log.
            jobStore.create({
              job_id: require('crypto').randomUUID(),
              source_file: audioPath,
              lrc_file: null,
              title: np.title, artist: np.artist, album: np.album,
              status: 'error',
              source: 'lrclib',
              auto_saved: true,
              created_at: new Date().toISOString(),
              error: { code: err.code || 'LYRICS_EMBED_FAILED', message: err.message },
            });
          }
        })
        .catch(err => logger.warn({ err: err.message, title: np.title }, 'Lyrics prefetch failed'));
    }
  });
}

module.exports = { findLocalFile, lyricsForNowPlaying, watchRoon, autoSave };
