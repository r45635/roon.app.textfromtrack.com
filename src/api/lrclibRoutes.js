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

const router = Router();

/** A busy or failing LRCLIB (503 ServerOverloaded, 429, 5xx) is an error, not "no lyrics". */
function throwIfBusy(result) {
  if (result && (result.status === 429 || result.status >= 500)) {
    const detail = result.body && (result.body.message || result.body.name);
    throw new Error(`LRCLIB HTTP ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

/**
 * GET /api/lrclib/lookup
 * Query params: title, artist, album (optional), duration (optional, seconds)
 *
 * Tries /api/get (exact match with duration), then /api/search as fallback.
 * Returns { found, synced, plain, instrumental, source }.
 */
router.get('/lookup', async (req, res) => {
  const { title, artist, album, duration, path: audioPath } = req.query;
  if (!title || !artist) {
    return res.status(400).json(buildError('MISSING_PARAMS', 'title and artist are required'));
  }

  // Check local cache before hitting lrclib.net
  const cachedLrc = (audioPath && lrcCache.get(audioPath)) || lrcCache.getByMeta(artist, title, album);
  if (cachedLrc) {
    logger.info({ title, artist }, 'LRCLIB lookup: cache hit, skipping lrclib.net');
    const hasSyncedLines = /^\[\d{2}:\d{2}\.\d{2}\]/m.test(cachedLrc);
    return res.json({
      found: true,
      fromCache: true,
      synced: hasSyncedLines ? cachedLrc : null,
      plain: hasSyncedLines ? null : cachedLrc,
      instrumental: false,
      trackName: title,
      artistName: artist,
      albumName: album || null,
      source: 'local_cache',
    });
  }

  try {
    // Build query string for /api/get
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) params.set('album_name', album);
    if (duration) params.set('duration', String(Math.round(Number(duration))));

    logger.info({ title, artist, album, duration }, 'LRCLIB lookup /api/get');
    const result = throwIfBusy(await lrclibGet(`/api/get?${params.toString()}`));

    // Not found, error response, or missing body → try search fallback
    if (!result || result.status < 200 || result.status >= 300 || !result.body) {
      logger.info({ title, artist }, 'LRCLIB /api/get not found, trying /api/search');
      const searchParams = new URLSearchParams({ track_name: title, artist_name: artist });
      const searchResult = throwIfBusy(await lrclibGet(`/api/search?${searchParams.toString()}`));

      if (!searchResult || !searchResult.body || !Array.isArray(searchResult.body) || searchResult.body.length === 0) {
        return res.json({ found: false });
      }

      // Pick the first result that has synced lyrics; else the first overall
      const hits = searchResult.body;
      const best = hits.find(h => h.syncedLyrics) || hits[0];
      const bestIdx = hits.indexOf(best);

      // Expose hit metadata (no lyrics) so the client can render a version picker without
      // bloating the response. Lyrics are fetched on-demand via GET /hit/:id when the user
      // switches to a different version.
      const allHits = hits.map(h => ({
        id: h.id,
        instrumental: !!h.instrumental,
        hasSynced: !!h.syncedLyrics,
        trackName: h.trackName || null,
        artistName: h.artistName || null,
        albumName: h.albumName || null,
      }));

      return res.json({
        found: true,
        synced: best.syncedLyrics || null,
        plain: best.plainLyrics || null,
        instrumental: !!best.instrumental,
        trackName: best.trackName,
        artistName: best.artistName,
        albumName: best.albumName,
        source: 'search',
        hits: allHits.length > 1 ? allHits : undefined,
        selectedHitIndex: allHits.length > 1 ? bestIdx : undefined,
      });
    }

    const data = result.body;
    if (data.instrumental) {
      return res.json({ found: true, instrumental: true, synced: null, plain: null, source: 'get' });
    }

    if (!data.syncedLyrics && !data.plainLyrics) {
      return res.json({ found: false });
    }

    return res.json({
      found: true,
      synced: data.syncedLyrics || null,
      plain: data.plainLyrics || null,
      instrumental: false,
      trackName: data.trackName,
      artistName: data.artistName,
      albumName: data.albumName,
      source: 'get',
    });
  } catch (err) {
    logger.error({ err: err.message }, 'LRCLIB lookup failed');
    // Return 200 so the browser does not log a 5xx console error.
    return res.json({ ...buildError('LRCLIB_ERROR', err.message), found: false });
  }
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
    const result = throwIfBusy(await lrclibGet(`/api/get/${id}`));
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
 * Query params: title, artist
 *
 * Runs /api/search on lrclib.net and returns the full list of hits (metadata
 * only, no lyrics). Used by the "See other versions" button on the client when
 * the initial /lookup returned an exact match via /api/get and the user wants
 * to browse alternatives.
 */
router.get('/search', async (req, res) => {
  const { title, artist } = req.query;
  if (!title || !artist) {
    return res.status(400).json(buildError('MISSING_PARAMS', 'title and artist are required'));
  }
  try {
    logger.info({ title, artist }, 'LRCLIB /search (on-demand versions)');
    const records = await lrclibClient.search({ title, artist });
    const hits = records.map(h => ({
      id: h.id,
      instrumental: !!h.instrumental,
      hasSynced: !!h.syncedLyrics,
      trackName: h.trackName || null,
      artistName: h.artistName || null,
      albumName: h.albumName || null,
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
