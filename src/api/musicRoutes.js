'use strict';

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { Router } = require('express');
const config = require('../config');
const logger = require('../utils/logger');
const { E, buildError } = require('../utils/normalize');
const scanner = require('../music/scanner');
const matcher = require('../music/matcher');
const lyricsDetector = require('../music/lyricsDetector');
const lyricsEmbedder = require('../music/lyricsEmbedder');
const flacTagger = require('../music/flacTagger');
const NodeID3 = require('node-id3');
const nowPlayingStore = require('../roon/nowPlayingStore');
const { getRoonStatus } = require('../roon/roonClient');
const userSettings = require('../storage/userSettings');
const lrcCache = require('../utils/lrcCache');
const jobStore = require('../textfromtrack/jobStore');

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
    save_lrc_beside_source_default: !!settings.save_lrc_beside_source_default,
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
    save_lrc_beside_source_default,
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

  const saveLrcBeside = save_lrc_beside_source_default === undefined
    ? undefined
    : !!save_lrc_beside_source_default;

  const update = {
    music_roots: cleanRoots,
    path_mappings: cleanMappings,
    embed_lyrics_default: embedDefault,
  };
  if (backupDefault !== undefined) update.backup_before_embed_default = backupDefault;
  if (saveLrcBeside !== undefined) update.save_lrc_beside_source_default = saveLrcBeside;
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
    save_lrc_beside_source_default: saveLrcBeside === undefined ? false : saveLrcBeside,
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
      // If no disk-based lyrics, check the LRC cache before reporting NO_LOCAL_LYRICS
      let finalStatus = liveStatus;
      if (liveStatus === lyricsDetector.STATUS.NO_LOCAL_LYRICS) {
        if (lrcCache.get(track.path)) {
          finalStatus = lyricsDetector.STATUS.HAS_CACHED_LYRICS;
        }
      }
      if (finalStatus !== track.lyrics_status) {
        logger.info(
          { path: track.path, cached: track.lyrics_status, live: finalStatus },
          'Lyrics status drift detected — refreshing index'
        );
        // Write-through: keep the index aligned for subsequent calls.
        // Only persist disk-based statuses to the index (cache status is dynamic).
        if (finalStatus !== lyricsDetector.STATUS.HAS_CACHED_LYRICS) {
          try {
            scanner.updateTrackLyricsStatus(track.path, finalStatus);
          } catch (err) {
            logger.warn({ err: err.message }, 'Could not write-through live lyrics status to index');
          }
        }
      }
      track.lyrics_status = finalStatus;
    } catch (err) {
      logger.warn({ err: err.message, path: track.path }, 'Live lyrics detection failed — keeping cached value');
    }
  }

  if (result) {
    if (result.matched && result.track) {
      await refreshTrackLyrics(result.track);
      // Inject audio format fields (lightweight parse, covers skipped)
      try {
        const { parseFile } = await import('music-metadata');
        const meta = await parseFile(result.track.path, { skipCovers: true, duration: false });
        const f = meta.format;
        result.track.sample_rate_hz  = f.sampleRate      || null;
        result.track.bits_per_sample = f.bitsPerSample   || null;
        result.track.lossless        = f.lossless        ?? null;
      } catch { /* non-fatal */ }
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

/**
 * Shared path validation helper — returns resolved path or sends 400/403/404.
 */
function resolveAndValidatePath(req, res) {
  const rawPath = req.query.path;
  if (!rawPath) {
    res.status(400).json(buildError(E.INVALID_REQUEST, 'path query parameter is required'));
    return null;
  }
  const resolved = path.resolve(rawPath);
  const settings = userSettings.get();
  const roots = settings.music_roots.length ? settings.music_roots : config.musicRoots;
  const allowed = roots.some(r => resolved.startsWith(path.resolve(r) + path.sep) || resolved === path.resolve(r));
  if (!allowed) {
    res.status(403).json(buildError('FORBIDDEN', 'Path is not under a configured music root'));
    return null;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json(buildError('FILE_NOT_FOUND', 'File not found'));
    return null;
  }
  return resolved;
}

/**
 * GET /api/music/file-cover?path=<encoded>
 * Returns embedded cover images from an audio file as base64 data URLs.
 */
router.get('/file-cover', async (req, res) => {
  const resolved = resolveAndValidatePath(req, res);
  if (!resolved) return;

  try {
    const { parseFile } = await import('music-metadata');
    // Use AbortSignal.timeout so slow/large files on external drives don't hang forever
    const metadata = await parseFile(resolved, {
      skipCovers: false,
      duration: false,
      signal: AbortSignal.timeout(8000),
    });
    const pictures = metadata.common.picture || [];
    const covers = pictures.map(p => ({
      mime: p.format,
      type: p.type || 'Cover (front)',
      description: p.description || null,
      data: `data:${p.format};base64,${Buffer.from(p.data).toString('base64')}`,
    }));
    res.json({ success: true, covers });
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ERR_OPERATION_ABORTED') {
      logger.warn({ path: resolved }, 'file-cover: parse timed out');
      return res.json({ success: true, covers: [] });
    }
    logger.warn({ path: resolved, err: err.message }, 'file-cover: parse failed');
    res.status(500).json(buildError('PARSE_ERROR', `Cannot read covers: ${err.message}`));
  }
});

/**
 * GET /api/music/file-lyrics?path=<encoded>
 * Returns lyrics from .lrc sidecar or embedded tags, or null if none.
 */
router.get('/file-lyrics', async (req, res) => {
  const resolved = resolveAndValidatePath(req, res);
  if (!resolved) return;

  try {
    // 1. .lrc sidecar
    const lrcPath = lyricsDetector.getLrcPath(resolved);
    if (fs.existsSync(lrcPath)) {
      const text = fs.readFileSync(lrcPath, 'utf8');
      return res.json({ success: true, source: 'lrc', text });
    }
    // 2. Embedded lyrics
    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(resolved, { skipCovers: true, duration: false });
    const lyricsArr = metadata.common.lyrics || [];
    const text = lyricsArr
      .map(l => {
        if (typeof l === 'string') return l;
        if (l?.text) return l.text;
        // Synchronized lyrics: reconstruct LRC format with [MM:SS.xx] timestamps
        if (Array.isArray(l?.syncText) && l.syncText.length > 0) {
          return l.syncText.map(s => {
            const ms = s.timestamp || 0;
            const mins = Math.floor(ms / 60000);
            const secs = Math.floor((ms % 60000) / 1000);
            const centis = Math.floor((ms % 1000) / 10);
            const tag = `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}]`;
            return `${tag}${s.text || ''}`;
          }).filter(s => s.trim()).join('\n');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (text) return res.json({ success: true, source: 'embedded', text });

    // 3. LRC cache (only when include_cache param is set)
    if (req.query.include_cache === '1' || req.query.include_cache === 'true') {
      const cached = lrcCache.get(resolved);
      if (cached) return res.json({ success: true, source: 'cache', text: cached });
    }

    return res.json({ success: true, source: null, text: null });
  } catch (err) {
    logger.warn({ path: resolved, err: err.message }, 'file-lyrics: parse failed');
    res.status(500).json(buildError('PARSE_ERROR', `Cannot read lyrics: ${err.message}`));
  }
});

/**
 * GET /api/music/file-tags?path=<encoded>
 * Reads the full audio tags and format info from a local file on demand.
 * The path is validated against configured music_roots to prevent traversal.
 */
router.get('/file-tags', async (req, res) => {
  const resolved = resolveAndValidatePath(req, res);
  if (!resolved) return;

  let metadata;
  try {
    const { parseFile } = await import('music-metadata');
    metadata = await parseFile(resolved, { skipCovers: true, duration: true });
  } catch (err) {
    logger.warn({ path: resolved, err: err.message }, 'file-tags: metadata parse failed');
    return res.status(500).json(buildError('PARSE_ERROR', `Cannot read metadata: ${err.message}`));
  }

  const { common, format } = metadata;

  res.json({
    success: true,
    tags: {
      title:               common.title        || null,
      artist:              common.artist        || null,
      artists:             common.artists       || [],
      albumartist:         common.albumartist   || null,
      album:               common.album         || null,
      year:                common.year          || null,
      genre:               (common.genre && common.genre.join(', ')) || null,
      comment:             (common.comment && common.comment[0]?.text) || null,
      track_no:            (common.track && common.track.no)    || null,
      track_total:         (common.track && common.track.of)    || null,
      disc_no:             (common.disk  && common.disk.no)     || null,
      disc_total:          (common.disk  && common.disk.of)     || null,
      isrc:                common.isrc          || null,
      musicbrainz_trackid: (common.musicbrainz && common.musicbrainz.trackId) || null,
      musicbrainz_albumid: (common.musicbrainz && common.musicbrainz.albumId) || null,
      label:               (common.label && common.label[0]) || null,
      composer:            (common.composer && common.composer[0]) || null,
    },
    format: {
      codec:           format.codec           || null,
      container:       format.container       || null,
      bitrate_kbps:    format.bitrate         ? Math.round(format.bitrate / 1000) : null,
      sample_rate_hz:  format.sampleRate      || null,
      channels:        format.numberOfChannels || null,
      bits_per_sample: format.bitsPerSample   || null,
      lossless:        format.lossless        ?? null,
      duration_seconds: format.duration       ? Math.round(format.duration * 10) / 10 : null,
      tag_types:       format.tagTypes        || [],
    },
  });
});

/**
 * POST /api/music/file-lyrics
 * Body: { path, lrc_content }
 * Writes lyrics to the audio file and/or an .lrc sidecar using user preferences
 * (embed_lyrics_default, backup_before_embed_default, save_lrc_beside_source_default).
 * This is the generic "Transfer to File Tags" endpoint used by both LRCLIB and TFT providers.
 */
router.post('/file-lyrics', async (req, res) => {
  const { path: audioPath, lrc_content } = req.body || {};

  if (!audioPath || typeof audioPath !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'path is required'));
  }
  if (!lrc_content || typeof lrc_content !== 'string' || lrc_content.trim().length === 0) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'lrc_content is required'));
  }

  const resolved = path.resolve(audioPath);
  const settings = userSettings.get();
  const roots = settings.music_roots.length ? settings.music_roots : config.musicRoots;
  const allowed = roots.some(r => resolved.startsWith(path.resolve(r) + path.sep) || resolved === path.resolve(r));
  if (!allowed) {
    return res.status(403).json(buildError('FORBIDDEN', 'Path is not under a configured music root'));
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json(buildError('FILE_NOT_FOUND', 'File not found'));
  }

  const bodyHas = (key) => req.body && Object.prototype.hasOwnProperty.call(req.body, key);
  const doEmbed      = bodyHas('embed')       ? !!req.body.embed       : !!settings.embed_lyrics_default;
  const doBackup     = bodyHas('backup')      ? !!req.body.backup      : (settings.backup_before_embed_default !== false);
  const doSaveBeside = bodyHas('save_beside') ? !!req.body.save_beside : !!settings.save_lrc_beside_source_default;

  const result = { success: true, lrc_file: null, lyrics_embedded: false, backup_path: null };

  try {
    if (doSaveBeside) {
      const lrcPath = resolved.replace(/\.[^.]+$/, '.lrc');
      fs.writeFileSync(lrcPath, lrc_content, 'utf8');
      result.lrc_file = lrcPath;
      logger.info({ lrcPath }, 'file-lyrics POST: LRC sidecar written');
    }

    if (doEmbed) {
      const embedResult = lyricsEmbedder.embedLyrics(resolved, lrc_content, {
        backup: { enabled: doBackup, onConflict: 'overwrite' },
      });
      result.lyrics_embedded = true;
      result.backup_path = embedResult.backup_path || null;
      logger.info({ audioPath: resolved }, 'file-lyrics POST: lyrics embedded');
    }

    try {
      const newStatus = doEmbed
        ? lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS
        : doSaveBeside
          ? lyricsDetector.STATUS.HAS_LRC_FILE
          : null;
      if (newStatus) scanner.updateTrackLyricsStatus(resolved, newStatus);
    } catch { /* non-fatal */ }

    res.json(result);
  } catch (err) {
    logger.error({ err: err.message, path: resolved }, 'file-lyrics POST: write failed');
    res.status(500).json(buildError('WRITE_ERROR', err.message));
  }
});

/**
 * DELETE /api/music/file-lyrics?path=<encoded>
 * Removes embedded lyrics from a FLAC (LYRICS vorbis tag) or MP3 (USLT frame).
 */
router.delete('/file-lyrics', (req, res) => {
  const resolved = resolveAndValidatePath(req, res);
  if (!resolved) return;
  try {
    const result = lyricsEmbedder.removeLyrics(resolved);
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.code === E.SOURCE_FILE_NOT_FOUND ? 404
                 : err.code === E.LYRICS_EMBED_UNSUPPORTED ? 422
                 : 500;
    res.status(status).json(buildError(err.code || 'REMOVE_ERROR', err.message));
  }
});

/**
 * PATCH /api/music/file-tags?path=<encoded>
 * Body: { tags: { title, artist, albumartist, album, year, genre, track, disc,
 *                 composer, label, comment, isrc } }
 * null = remove the tag. Omitted fields are left untouched.
 */

// Map from our "common" field names to FLAC vorbis keys
const VORBIS_FIELD_MAP = {
  title:       'TITLE',
  artist:      'ARTIST',
  albumartist: 'ALBUMARTIST',
  album:       'ALBUM',
  year:        'DATE',
  genre:       'GENRE',
  comment:     'COMMENT',
  track:       'TRACKNUMBER',
  disc:        'DISCNUMBER',
  composer:    'COMPOSER',
  label:       'ORGANIZATION',
  isrc:        'ISRC',
};

router.patch('/file-tags', async (req, res) => {
  const resolved = resolveAndValidatePath(req, res);
  if (!resolved) return;

  const incomingTags = req.body?.tags;
  if (!incomingTags || typeof incomingTags !== 'object' || Array.isArray(incomingTags)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'Body must be { tags: {...} }'));
  }

  const ext = path.extname(resolved).toLowerCase();

  try {
    if (ext === '.flac') {
      const updates = {};
      for (const [field, vorbisKey] of Object.entries(VORBIS_FIELD_MAP)) {
        if (Object.prototype.hasOwnProperty.call(incomingTags, field)) {
          updates[vorbisKey] = incomingTags[field] == null ? null : String(incomingTags[field]);
        }
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json(buildError(E.INVALID_REQUEST, 'No recognized tag fields in body'));
      }
      const result = flacTagger.setVorbisTags(resolved, updates);
      logger.info({ path: resolved, fields: Object.keys(updates) }, 'file-tags PATCH (FLAC)');
      return res.json({ success: true, format: 'flac', ...result });
    }

    if (ext === '.mp3') {
      const currentTags = NodeID3.read(resolved);
      const apply = (key, value) => {
        if (value == null || String(value).trim() === '') delete currentTags[key];
        else currentTags[key] = value;
      };
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'title'))       apply('title', incomingTags.title);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'artist'))      apply('artist', incomingTags.artist);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'albumartist')) apply('performerInfo', incomingTags.albumartist);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'album'))       apply('album', incomingTags.album);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'year'))        apply('year', incomingTags.year);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'genre'))       apply('genre', incomingTags.genre);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'track'))       apply('trackNumber', incomingTags.track);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'disc'))        apply('partOfSet', incomingTags.disc);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'composer'))    apply('composer', incomingTags.composer);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'isrc'))        apply('TSRC', incomingTags.isrc);
      if (Object.prototype.hasOwnProperty.call(incomingTags, 'comment')) {
        const v = incomingTags.comment;
        if (!v) delete currentTags.comment;
        else currentTags.comment = { language: 'eng', shortText: '', text: String(v) };
      }
      const ok = NodeID3.write(currentTags, resolved);
      if (ok !== true) throw new Error(ok?.message || 'NodeID3.write failed');
      logger.info({ path: resolved }, 'file-tags PATCH (MP3)');
      return res.json({ success: true, format: 'mp3' });
    }

    return res.status(422).json(buildError('UNSUPPORTED_FORMAT', `Tag editing not supported for ${ext} files`));
  } catch (err) {
    logger.warn({ path: resolved, err: err.message }, 'file-tags PATCH failed');
    res.status(500).json(buildError('WRITE_ERROR', err.message));
  }
});

/**
 * GET /api/music/open-folder?path=<encoded>
 * Opens the containing folder of the given file in the system file manager (macOS Finder).
 */
router.get('/open-folder', (req, res) => {
  const resolved = resolveAndValidatePath(req, res);
  if (!resolved) return;
  const dir = path.dirname(resolved);
  exec(`open ${JSON.stringify(dir)}`, err => {
    if (err) {
      logger.warn({ dir, err: err.message }, 'open-folder failed');
      return res.status(500).json(buildError('OPEN_FOLDER_ERROR', err.message));
    }
    res.json({ success: true });
  });
});

module.exports = router;
