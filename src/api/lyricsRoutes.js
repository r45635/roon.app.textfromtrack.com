'use strict';

const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const logger = require('../utils/logger');
const { E, buildError } = require('../utils/normalize');
const nowPlayingStore = require('../roon/nowPlayingStore');
const { getRoonStatus, getNowPlaying } = require('../roon/roonClient');
const musicRoots = require('../music/musicRoots');
const lyricsResolver = require('../lyrics/lyricsResolver');
const { lyricsForNowPlaying } = require('../lyrics/nowPlayingLyrics');

const router = Router();

/** Pick the track fields the resolver keys on from a request body. */
function trackFromBody(body) {
  const { title, artist, album } = body || {};
  if (typeof title !== 'string' || !title.trim() || typeof artist !== 'string' || !artist.trim()) return null;
  return { title, artist, album: typeof album === 'string' ? album : null };
}

/**
 * GET /api/lyrics/current
 * Lyrics of the track playing in a zone — works with or without a music folder.
 * Query: zone_id (optional, defaults to the active zone), path (optional, a local file the
 * viewer picked instead of the automatic match; must be under a music root).
 */
router.get('/current', async (req, res) => {
  const { zone_id: zoneId, path: rawPath } = req.query;
  const np = zoneId ? getNowPlaying(String(zoneId)) : nowPlayingStore.get();
  if (!np) {
    const roon = getRoonStatus();
    if (!roon.connected) {
      return res.status(503).json(buildError(E.ROON_NOT_CONNECTED, 'Roon Core is not connected'));
    }
    return res.status(404).json(buildError(E.NO_CURRENT_TRACK, 'No track is currently playing'));
  }

  let audioPath;
  if (rawPath) {
    const resolved = path.resolve(String(rawPath));
    if (!musicRoots.isUnderMusicRoot(resolved)) {
      return res.status(403).json(buildError(E.FORBIDDEN, 'Path is not under a configured music root'));
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json(buildError(E.SOURCE_FILE_NOT_FOUND, 'File not found'));
    }
    audioPath = resolved;
  }

  try {
    const result = await lyricsForNowPlaying(np, { audioPath });
    res.json({
      success: true,
      track: {
        zone_id: np.zone_id,
        title: np.title,
        artist: np.artist,
        album: np.album,
        duration_seconds: np.duration_seconds,
      },
      library_configured: musicRoots.getMusicRoots().length > 0,
      audio_path: result.audioPath,
      lyrics: result.lyrics,
    });
  } catch (err) {
    logger.error({ err: err.message }, '/api/lyrics/current failed');
    res.status(500).json(buildError(E.UNKNOWN_ERROR, err.message));
  }
});

/**
 * POST /api/lyrics/choose
 * Use a specific LRCLIB record for a track from now on.
 * Body: { title, artist, album?, lrclib_id }
 */
router.post('/choose', async (req, res) => {
  const track = trackFromBody(req.body);
  const lrclibId = Number(req.body && req.body.lrclib_id);
  if (!track || !Number.isInteger(lrclibId) || lrclibId <= 0) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'title, artist and a numeric lrclib_id are required'));
  }
  try {
    const lyrics = await lyricsResolver.choose(track, lrclibId);
    res.json({ success: true, lyrics });
  } catch (err) {
    const status = err.code === E.NOT_FOUND ? 404 : 502;
    logger.warn({ err: err.message, lrclibId }, '/api/lyrics/choose failed');
    res.status(status).json(buildError(err.code || E.LRCLIB_ERROR, err.message));
  }
});

/**
 * POST /api/lyrics/offset
 * Save a track's timing offset (positive = lyrics shown later).
 * Body: { title, artist, album?, offset_ms }
 */
router.post('/offset', (req, res) => {
  const track = trackFromBody(req.body);
  const offsetMs = Number(req.body && req.body.offset_ms);
  if (!track || !Number.isFinite(offsetMs)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'title, artist and a numeric offset_ms are required'));
  }
  res.json({ success: true, offset_ms: lyricsResolver.setOffset(track, offsetMs) });
});

module.exports = router;
