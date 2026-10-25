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
 * @param {{ audioPath?: string|null }} [opts] a file the viewer picked; omitted = auto-match
 * @returns {Promise<{ lyrics: object, audioPath: string|null }>}
 */
async function lyricsForNowPlaying(np, opts = {}) {
  const audioPath = opts.audioPath !== undefined ? opts.audioPath : findLocalFile(np);
  const lyrics = await lyricsResolver.resolve(np, { audioPath });
  return { lyrics, audioPath };
}

/**
 * Prefetch lyrics whenever a zone starts playing a new track.
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
        .then(({ lyrics }) => logger.debug(
          { zone: np.zone_name, title: np.title, source: lyrics.source, found: lyrics.found },
          'Lyrics prefetched'
        ))
        .catch(err => logger.warn({ err: err.message, title: np.title }, 'Lyrics prefetch failed'));
    }
  });
}

module.exports = { findLocalFile, lyricsForNowPlaying, watchRoon };
