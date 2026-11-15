'use strict';

const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const logger = require('../utils/logger');
const { buildError } = require('../utils/normalize');
const scanner = require('../music/scanner');
const lrcCache = require('../utils/lrcCache');
const lyricsWriter = require('../music/lyricsWriter');
const musicRoots = require('../music/musicRoots');
const jobStore = require('../textfromtrack/jobStore');
const lrclibClient = require('../lyrics/lrclibClient');
const { lrclibGet } = lrclibClient;
const { lookupLyrics } = require('../lyrics/lyricsLookup');
const lyricsResolver = require('../lyrics/lyricsResolver');

const router = Router();

/**
 * GET /api/lrclib/lookup
 * Query params: title, artist, album (optional), duration (optional, seconds)
 *
 * Tries /api/get (exact match with duration), then /api/search as fallback.
 * Returns { found, synced, plain, instrumental, source }.
 */
router.get('/lookup', async (req, res) => {
  const { title, artist } = req.query;
  if (!title || !artist) {
    return res.status(400).json(buildError('MISSING_PARAMS', 'title and artist are required'));
  }
  res.json(await lookupLyrics(req.query));
});

/**
 * GET /api/lrclib/hit/:id
 * Fetches lyrics for a specific LRCLIB track by numeric ID.
 * Used by the version picker when the user switches to a hit other than the best one.
 */
router.get('/hit/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || !/^\d+$/.test(id)) {
    return res.status(400).json(buildError('INVALID_ID', 'id must be a numeric LRCLIB track id'));
  }
  try {
    const result = await lrclibGet(`/api/get/${id}`);
    if (!result || !result.body) {
      return res.json({ found: false });
    }
    const d = result.body;
    return res.json({
      found: true,
      synced: d.syncedLyrics || null,
      plain: d.plainLyrics || null,
      instrumental: !!d.instrumental,
      trackName: d.trackName,
      artistName: d.artistName,
      albumName: d.albumName,
      source: 'search',
    });
  } catch (err) {
    logger.error({ err: err.message }, 'LRCLIB hit fetch failed');
    return res.json({ ...buildError('LRCLIB_ERROR', err.message), found: false });
  }
});

/**
 * GET /api/lrclib/search
 * Query params: title, artist; optional album, duration (seconds) of the playing track
 *
 * Runs /api/search on the LRCLIB servers and returns the full list of hits (metadata
 * only, no lyrics), best fit first when the track is given — the order the automatic choice
 * uses. Used by the "Other versions" picker.
 */
router.get('/search', async (req, res) => {
  const { title, artist, album } = req.query;
  if (!title || !artist) {
    return res.status(400).json(buildError('MISSING_PARAMS', 'title and artist are required'));
  }
  const duration = Number(req.query.duration) > 0 ? Number(req.query.duration) : null;
  try {
    logger.info({ title, artist }, 'LRCLIB /search (on-demand versions)');
    const records = await lrclibClient.search({ title, artist });
    const ranked = lyricsResolver.rankHits(records, { title, album, duration_seconds: duration }, { keepEmpty: true });
    const hits = ranked.map(h => ({
      id: h.id,
      instrumental: !!h.instrumental,
      hasSynced: !!h.syncedLyrics,
      damaged: lyricsResolver.isDamaged(h.syncedLyrics || h.plainLyrics),
      trackName: h.trackName || null,
      artistName: h.artistName || null,
      albumName: h.albumName || null,
      duration: Number.isFinite(h.duration) ? h.duration : null,
    }));
    return res.json({ hits });
  } catch (err) {
    logger.error({ err: err.message }, 'LRCLIB search failed');
    return res.json({ ...buildError('LRCLIB_ERROR', err.message), hits: [] });
  }
});

/**
 * POST /api/lrclib/save
 * Body: { path, lrc_content, embed, backup, save_beside }
 *   - path        : absolute path to the audio file
 *   - lrc_content : LRC text to save
 *   - embed       : boolean (default: user setting)
 *   - backup      : boolean (default: user setting)
 *   - save_beside : boolean (default: user setting) — write .lrc next to audio
 *
 * Returns { success, lrc_file, lyrics_embedded, backup_path }.
 */
router.post('/save', async (req, res) => {
  const { path: audioPath, lrc_content } = req.body || {};

  if (!audioPath || typeof audioPath !== 'string') {
    return res.status(400).json(buildError('MISSING_PATH', 'path is required'));
  }
  if (!lrc_content || typeof lrc_content !== 'string' || lrc_content.trim().length === 0) {
    return res.status(400).json(buildError('MISSING_CONTENT', 'lrc_content is required'));
  }

  // Validate path is within a configured music root (security)
  const resolved = path.resolve(audioPath);
  if (!musicRoots.isUnderMusicRoot(resolved)) {
    logger.warn({ audioPath: resolved }, 'LRCLIB save: path outside music roots');
    return res.status(403).json(buildError('OUTSIDE_MUSIC_ROOT', 'Path is not within a configured music root'));
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json(buildError('SOURCE_FILE_NOT_FOUND', `File not found: ${resolved}`));
  }

  const result = { success: true, lrc_file: null, lyrics_embedded: false, backup_path: null };

  try {
    const written = lyricsWriter.writeLyricsToFile(resolved, lrc_content, req.body);
    result.lrc_file = written.lrc_file;
    result.lyrics_embedded = written.lyrics_embedded;
    result.backup_path = written.backup_path;

    // Update scanner index lyrics_status
    try {
      scanner.updateTrackLyricsStatus(resolved, written.status);
    } catch (err) {
      logger.warn({ err: err.message, audioPath: resolved }, 'LRCLIB save: index status not updated');
    }

    // Write to local LRC cache
    const bodyMeta = req.body || {};
    lrcCache.setAll(
      resolved,
      typeof bodyMeta.artist === 'string' ? bodyMeta.artist : null,
      typeof bodyMeta.title === 'string' ? bodyMeta.title : null,
      typeof bodyMeta.album === 'string' ? bodyMeta.album : null,
      lrc_content
    );

    // Job record so this appears in Job History
    jobStore.recordLyricsSave({
      sourceFile: resolved,
      lrc: lrc_content,
      title: typeof bodyMeta.title === 'string' ? bodyMeta.title : null,
      artist: typeof bodyMeta.artist === 'string' ? bodyMeta.artist : null,
      album: typeof bodyMeta.album === 'string' ? bodyMeta.album : null,
      written: result,
    });

    return res.json(result);
  } catch (err) {
    logger.error({ err: err.message, audioPath: resolved }, 'LRCLIB save failed');
    return res.status(500).json(buildError(err.code || 'SAVE_FAILED', err.message));
  }
});

module.exports = router;
