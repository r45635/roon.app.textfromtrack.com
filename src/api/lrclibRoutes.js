'use strict';

const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const https = require('https');
const logger = require('../utils/logger');
const { buildError } = require('../utils/normalize');
const lyricsEmbedder = require('../music/lyricsEmbedder');
const lyricsDetector = require('../music/lyricsDetector');
const scanner = require('../music/scanner');
const userSettings = require('../storage/userSettings');
const config = require('../config');
const lrcCache = require('../utils/lrcCache');
const jobStore = require('../textfromtrack/jobStore');

const router = Router();

const LRCLIB_BASE = 'https://lrclib.net';
const USER_AGENT = 'TextFromTrackRoonCompanion/1.0 (https://roon.app.textfromtrack.com)';

const LRCLIB_TIMEOUT_MS = 20000; // per-request hard deadline (connect + download)

/**
 * Performs a GET request to LRCLIB and resolves with parsed JSON.
 * Uses a hard AbortController deadline so slow connections don't block forever.
 */
function lrclibGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = `${LRCLIB_BASE}${urlPath}`;

    // Hard timeout: fires whether the socket is idle or just slow.
    const timer = setTimeout(() => {
      req.destroy(new Error(`LRCLIB request timed out after ${LRCLIB_TIMEOUT_MS / 1000}s`));
    }, LRCLIB_TIMEOUT_MS);

    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      const chunks = [];
      res.on('data', chunk => { chunks.push(chunk); });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode === 404) return resolve(null);
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: null });
        }
      });
      res.on('error', err => { clearTimeout(timer); reject(err); });
    });
    req.on('error', err => { clearTimeout(timer); reject(err); });
  });
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
    const result = await lrclibGet(`/api/get?${params.toString()}`);

    // Not found, error response, or missing body → try search fallback
    if (!result || result.status < 200 || result.status >= 300 || !result.body) {
      logger.info({ title, artist }, 'LRCLIB /api/get not found, trying /api/search');
      const searchParams = new URLSearchParams({ track_name: title, artist_name: artist });
      const searchResult = await lrclibGet(`/api/search?${searchParams.toString()}`);

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
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    logger.info({ title, artist }, 'LRCLIB /search (on-demand versions)');
    const result = await lrclibGet(`/api/search?${params.toString()}`);
    if (!result || !Array.isArray(result.body) || result.body.length === 0) {
      return res.json({ hits: [] });
    }
    const hits = result.body.map(h => ({
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
  const settings = userSettings.get();
  const roots = settings.music_roots && settings.music_roots.length
    ? settings.music_roots
    : config.musicRoots;
  const resolved = path.resolve(audioPath);
  const inRoot = roots.some(r => resolved.startsWith(path.resolve(r) + path.sep) || resolved === path.resolve(r));
  if (!inRoot) {
    logger.warn({ audioPath: resolved }, 'LRCLIB save: path outside music roots');
    return res.status(403).json(buildError('OUTSIDE_MUSIC_ROOT', 'Path is not within a configured music root'));
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json(buildError('SOURCE_FILE_NOT_FOUND', `File not found: ${resolved}`));
  }

  // Resolve flags
  const bodyHas = (key) => req.body && Object.prototype.hasOwnProperty.call(req.body, key);
  const doEmbed = bodyHas('embed') ? !!req.body.embed : !!settings.embed_lyrics_default;
  const doBackup = bodyHas('backup') ? !!req.body.backup : !!settings.backup_before_embed_default;
  const doSaveBeside = bodyHas('save_beside') ? !!req.body.save_beside : !!settings.save_lrc_beside_source_default;

  const lrcPath = resolved.replace(/\.[^.]+$/, '.lrc');
  const result = { success: true, lrc_file: null, lyrics_embedded: false, backup_path: null };

  try {
    // Write .lrc sidecar
    if (doSaveBeside) {
      fs.writeFileSync(lrcPath, lrc_content, 'utf8');
      result.lrc_file = lrcPath;
      logger.info({ lrcPath }, 'LRCLIB: LRC sidecar written');
    }

    // Embed into audio tags
    if (doEmbed) {
      const embedResult = lyricsEmbedder.embedLyrics(resolved, lrc_content, {
        backup: { enabled: doBackup, onConflict: 'overwrite' },
      });
      result.lyrics_embedded = true;
      result.backup_path = embedResult.backup_path;
      logger.info({ audioPath: resolved }, 'LRCLIB: lyrics embedded');
    }

    // Update scanner index lyrics_status
    try {
      const newStatus = doEmbed
        ? lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS
        : doSaveBeside
          ? lyricsDetector.STATUS.HAS_LRC_FILE
          : null;
      if (newStatus) scanner.updateTrackLyricsStatus(resolved, newStatus);
    } catch { /* non-fatal */ }

    // Write to local LRC cache
    const bodyMeta = req.body || {};
    lrcCache.setAll(
      resolved,
      typeof bodyMeta.artist === 'string' ? bodyMeta.artist : null,
      typeof bodyMeta.title === 'string' ? bodyMeta.title : null,
      typeof bodyMeta.album === 'string' ? bodyMeta.album : null,
      lrc_content
    );

    // Create a job record so this appears in Job History
    const { randomUUID } = require('crypto');
    const segmentCount = (lrc_content.match(/^\[[\d:\.]+\]/gm) || []).length;
    const hasTimestamps = segmentCount > 0;
    const lrclibJob = {
      job_id: randomUUID(),
      source_file: resolved,
      lrc_file: result.lrc_file,
      title: (typeof bodyMeta.title === 'string' ? bodyMeta.title : null),
      artist: (typeof bodyMeta.artist === 'string' ? bodyMeta.artist : null),
      album: (typeof bodyMeta.album === 'string' ? bodyMeta.album : null),
      status: 'done',
      source: 'lrclib',
      cache_hit: false,
      embed_requested: doEmbed,
      force_requested: false,
      lyrics_embedded: result.lyrics_embedded,
      timestamps_requested: 'auto',
      timestamps_mode: null,
      credits_quoted: 0,
      credits_charged: 0,
      segment_count: segmentCount,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      has_timestamps: hasTimestamps,
      has_timestamps_source: 'lrc_content',
      embed_error: null,
      backup_path: result.backup_path || null,
      backup_created: !!result.backup_path,
      error: null,
    };
    jobStore.create(lrclibJob);

    return res.json(result);
  } catch (err) {
    logger.error({ err: err.message, audioPath: resolved }, 'LRCLIB save failed');
    return res.status(500).json(buildError(err.code || 'SAVE_FAILED', err.message));
  }
});

module.exports = router;
