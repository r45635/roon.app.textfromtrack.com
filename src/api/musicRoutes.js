'use strict';

const { Router } = require('express');
const config = require('../config');
const logger = require('../utils/logger');
const { E, buildError } = require('../utils/normalize');
const scanner = require('../music/scanner');
const matcher = require('../music/matcher');
const lyricsDetector = require('../music/lyricsDetector');
const nowPlayingStore = require('../roon/nowPlayingStore');
const { getRoonStatus } = require('../roon/roonClient');
const userSettings = require('../storage/userSettings');

const router = Router();

/**
 * GET /api/music/index/status
 * Returns index metadata (track count, last scan, configured roots).
 */
router.get('/index/status', (req, res) => {
  const index = scanner.loadIndex();
  res.json({
    success: true,
    track_count: index.track_count,
    last_scan_at: index.last_scan_at,
    music_roots: index.music_roots,
    scan_in_progress: scanner.isScanInProgress(),
  });
});

/**
 * POST /api/music/index/rescan
 * Triggers a full re-scan of all configured music roots.
 * Returns immediately; scan runs in the background.
 */
router.post('/index/rescan', (req, res) => {
  if (scanner.isScanInProgress()) {
    return res.status(409).json(buildError('SCAN_IN_PROGRESS', 'A scan is already running'));
  }
  const settings = userSettings.get();
  const roots = settings.music_roots.length ? settings.music_roots : config.musicRoots;
  if (!roots.length) {
    return res.status(400).json(buildError('NO_MUSIC_ROOTS', 'MUSIC_ROOTS is not configured'));
  }

  scanner.scan().catch(err => logger.error({ err: err.message }, 'Background scan failed'));
  res.json({ success: true, message: 'Scan started in background' });
});

/**
 * GET /api/music/config
 * Returns the current music library configuration (roots, path mappings).
 */
router.get('/config', (req, res) => {
  const settings = userSettings.get();
  const roots = settings.music_roots.length ? settings.music_roots : config.musicRoots;
  const mappings = settings.path_mappings.length ? settings.path_mappings : config.pathMappings;
  res.json({
    success: true,
    music_roots: roots,
    path_mappings: mappings,
    embed_lyrics_default: !!settings.embed_lyrics_default,
    backup_before_embed_default: settings.backup_before_embed_default !== false,
  });
});

/**
 * POST /api/music/config
 * Update music library configuration and persist to user-settings.json.
 * Body: { music_roots: string[], path_mappings?: {from:string,to:string}[] }
 */
router.post('/config', (req, res) => {
  const {
    music_roots,
    path_mappings,
    embed_lyrics_default,
    backup_before_embed_default,
  } = req.body || {};
  if (!Array.isArray(music_roots)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'music_roots must be an array'));
  }
  const cleanRoots = music_roots.map(s => String(s).trim()).filter(Boolean);
  const cleanMappings = Array.isArray(path_mappings)
    ? path_mappings.filter(m => m && typeof m.from === 'string' && typeof m.to === 'string')
    : [];
  const embedDefault = !!embed_lyrics_default;
  // backup default: if undefined, leave at storage default (true)
  const backupDefault = backup_before_embed_default === undefined
    ? undefined
    : !!backup_before_embed_default;

  const update = {
    music_roots: cleanRoots,
    path_mappings: cleanMappings,
    embed_lyrics_default: embedDefault,
  };
  if (backupDefault !== undefined) update.backup_before_embed_default = backupDefault;
  userSettings.set(update);
  logger.info(
    { music_roots: cleanRoots, embed_lyrics_default: embedDefault, backup_before_embed_default: backupDefault },
    'Music library config updated'
  );
  res.json({
    success: true,
    music_roots: cleanRoots,
    path_mappings: cleanMappings,
    embed_lyrics_default: embedDefault,
    backup_before_embed_default: backupDefault === undefined ? true : backupDefault,
  });
});

/**
 * GET /api/music/match-current
 * Matches the current Roon track against the local music index.
 */
router.get('/match-current', async (req, res) => {
  const roon = getRoonStatus();
  if (!roon.connected) {
    return res.status(503).json(buildError(E.ROON_NOT_CONNECTED, 'Roon Core is not connected'));
  }

  const nowPlaying = nowPlayingStore.get();
  if (!nowPlaying) {
    return res.status(404).json(buildError(E.NO_CURRENT_TRACK, 'No track is currently playing'));
  }

  const index = scanner.loadIndex();
  const result = matcher.match(nowPlaying, index.tracks);

  // Live-detect lyrics status for the matched track AND every alternative we
  // surface. The cached value in the music-index reflects the state at the
  // last full scan (or at the moment of an embed/retry); it can be stale if
  // the user has edited / restored / moved tags since. Re-detecting is cheap
  // (one stat for the .lrc sidecar; one music-metadata parse only when no
  // sidecar is present) and ensures every path we display tells the truth.
  async function refreshTrackLyrics(track) {
    if (!track || !track.path) return;
    try {
      const liveStatus = await lyricsDetector.detect(track.path);
      if (liveStatus !== track.lyrics_status) {
        logger.info(
          { path: track.path, cached: track.lyrics_status, live: liveStatus },
          'Lyrics status drift detected — refreshing index'
        );
        // Write-through: keep the index aligned for subsequent calls.
        try {
          scanner.updateTrackLyricsStatus(track.path, liveStatus);
        } catch (err) {
          logger.warn({ err: err.message }, 'Could not write-through live lyrics status to index');
        }
      }
      track.lyrics_status = liveStatus;
    } catch (err) {
      logger.warn({ err: err.message, path: track.path }, 'Live lyrics detection failed — keeping cached value');
    }
  }

  if (result) {
    if (result.matched && result.track) {
      await refreshTrackLyrics(result.track);
    }
    if (Array.isArray(result.alternatives)) {
      // Run alternatives in parallel — they're independent and stat-bound.
      await Promise.all(result.alternatives.map(alt => refreshTrackLyrics(alt.track || alt)));
    }
  }

  res.json({
    success: true,
    now_playing: nowPlaying,
    match: result,
  });
});

module.exports = router;
