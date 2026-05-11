'use strict';

const fs = require('fs');
const { execFile } = require('child_process');
const { Router } = require('express');
const config = require('../config');
const logger = require('../utils/logger');
const { E, buildError, AppError } = require('../utils/normalize');
const tftClient = require('../textfromtrack/tftClient');
const transcriptionService = require('../textfromtrack/transcriptionService');
const { startTranscription, retryTranscription, embedExistingJob } = transcriptionService;
const jobStore = require('../textfromtrack/jobStore');
const nowPlayingStore = require('../roon/nowPlayingStore');
const { getRoonStatus } = require('../roon/roonClient');
const matcher = require('../music/matcher');
const scanner = require('../music/scanner');
const lyricsDetector = require('../music/lyricsDetector');
const userSettings = require('../storage/userSettings');

const router = Router();

/**
 * Returns the effective TFT token: env var takes priority, then user settings.
 * This allows the token to be set via the UI without restarting the server.
 */
function getEffectiveToken() {
  if (config.tftToken) return config.tftToken;
  const settings = userSettings.get();
  return settings.tft_token || '';
}

/**
 * GET /api/tft/config
 * Returns whether an API token is currently configured (never returns the raw token).
 */
router.get('/config', (req, res) => {
  const token = getEffectiveToken();
  res.json({
    success: true,
    token_configured: !!token,
    token_source: config.tftToken ? 'env' : (token ? 'user_settings' : 'none'),
  });
});

/**
 * POST /api/tft/config
 * Save or clear the TFT API token in user settings.
 * Body: { tft_token: string }
 * The raw token is NEVER returned in any response.
 */
router.post('/config', (req, res) => {
  const { tft_token } = req.body || {};
  if (typeof tft_token !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'tft_token must be a string'));
  }
  const cleaned = tft_token.trim();
  userSettings.set({ tft_token: cleaned });
  logger.info({ token_set: !!cleaned }, 'TFT token updated via UI');
  res.json({
    success: true,
    token_configured: !!cleaned,
  });
});

/**
 * GET /api/tft/me
 * Check API token and return safe account information.
 * The raw token is NEVER returned to the frontend.
 */
router.get('/me', async (req, res) => {
  if (!getEffectiveToken()) {
    return res.json({
      success: true,
      token_configured: false,
      email: null,
      credit_balance: null,
      credit_reserved: null,
      credit_available: null,
      top_up_url: null,
    });
  }

  try {
    const me = await tftClient.getMe();
    res.json({
      success: true,
      token_configured: true,
      email: me.email || null,
      credit_balance: me.credit_balance ?? null,
      credit_reserved: me.credit_reserved ?? null,
      credit_available: me.credit_available ?? null,
      top_up_url: me.top_up_url || null,
    });
  } catch (err) {
    logger.error({ err: err.message }, '/api/tft/me error');
    res.status(err.code === E.TFT_UNAUTHORIZED ? 401 : 502).json(
      buildError(err.code || E.UNKNOWN_ERROR, err.message)
    );
  }
});

/**
 * POST /api/tft/generate-current
 * Full flow:
 *  1. Get current Roon track
 *  2. Match to local file (must be high confidence)
 *  3. Check lyrics status
 *  4. Submit to TextFromTrack
 *  5. Return job_id immediately (polling continues in background)
 */
router.post('/generate-current', async (req, res) => {
  // 1. Roon checks
  const roon = getRoonStatus();
  if (!roon.connected) {
    return res.status(503).json(buildError(E.ROON_NOT_CONNECTED, 'Roon Core is not connected'));
  }
  if (!roon.authorized) {
    return res.status(403).json(buildError(E.ROON_NOT_AUTHORIZED, 'Extension is not authorized in Roon'));
  }

  const nowPlaying = nowPlayingStore.get();
  if (!nowPlaying || nowPlaying.state !== 'playing') {
    return res.status(404).json(buildError(E.NO_CURRENT_TRACK, 'No track is currently playing'));
  }

  // 2. Token check
  if (!getEffectiveToken()) {
    return res.status(400).json(buildError(E.TFT_TOKEN_MISSING, 'TFT_TOKEN is not configured'));
  }

  // 3. Match current track to local file (or use manually confirmed path)
  const index = scanner.loadIndex();
  const confirmedPath = req.body && typeof req.body.confirmed_path === 'string'
    ? req.body.confirmed_path.trim()
    : null;

  let track;
  if (confirmedPath) {
    // User manually selected an alternative candidate — find it in the index
    const confirmedTrack = index.tracks.find(t => t.path === confirmedPath);
    if (!confirmedTrack) {
      return res.status(404).json(buildError(E.NO_LOCAL_MATCH, 'Confirmed path not found in library index'));
    }
    track = confirmedTrack;
  } else {
    const matchResult = matcher.match(nowPlaying, index.tracks);

    if (!matchResult.matched) {
      return res.status(404).json(buildError(E.NO_LOCAL_MATCH, 'No local file found matching the current track'));
    }

    if (matchResult.confidence === 'low') {
      return res.status(422).json(
        buildError(
          E.LOW_CONFIDENCE_MATCH,
          'Match confidence is too low — please confirm the correct file manually',
          { match: matchResult }
        )
      );
    }

    track = matchResult.track;
  }

  // 4. Check lyrics status — bypassed when the caller forces a re-transcription
  const force = !!(req.body && req.body.force);
  if (!force && (
    track.lyrics_status === lyricsDetector.STATUS.HAS_LRC_FILE ||
    track.lyrics_status === lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS ||
    track.lyrics_status === lyricsDetector.STATUS.HAS_CACHED_LYRICS
  )) {
    return res.status(409).json(
      buildError(E.LYRICS_ALREADY_EXIST, 'This track already has local lyrics')
    );
  }

  // 5. Resolve embed + backup + saveBeside flags: explicit body value wins, else user setting default
  const settings = userSettings.get();
  const bodyEmbed = req.body && Object.prototype.hasOwnProperty.call(req.body, 'embed')
    ? !!req.body.embed
    : null;
  const embed = bodyEmbed !== null ? bodyEmbed : !!settings.embed_lyrics_default;
  const bodyBackup = req.body && Object.prototype.hasOwnProperty.call(req.body, 'backup')
    ? !!req.body.backup
    : null;
  const backup = bodyBackup !== null ? bodyBackup : !!settings.backup_before_embed_default;
  const bodySaveBeside = req.body && Object.prototype.hasOwnProperty.call(req.body, 'save_beside')
    ? !!req.body.save_beside
    : null;
  const saveBeside = bodySaveBeside !== null ? bodySaveBeside : !!settings.save_lrc_beside_source_default;
  // For the auto-flow we don't have a way to surface a 409 modal mid-job, so
  // when a backup conflict happens we KEEP the existing .org by default.
  const onConflict = (req.body && req.body.backup_conflict) || 'keep';

  // 6. Start transcription (validates + submits + background polls)
  try {
    const result = await transcriptionService.startTranscription(
      track.path,
      { title: track.title, artist: track.artist, album: track.album },
      {
        pinyin: config.tftDefaultPinyin,
        vintage: config.tftDefaultVintage,
        embed,
        backup: { enabled: backup, onConflict },
        force,
        saveBeside,
      }
    );
    res.status(202).json(result);
  } catch (err) {
    logger.error({ err: err.message, code: err.code }, 'generate-current error');
    const httpStatus = {
      [E.TFT_TOKEN_MISSING]: 400,
      [E.TFT_UNAUTHORIZED]: 401,
      [E.TFT_INSUFFICIENT_CREDITS]: 402,
      [E.LYRICS_ALREADY_EXIST]: 409,
      [E.LRC_ALREADY_EXISTS]: 409,
      [E.SOURCE_FILE_NOT_FOUND]: 404,
      [E.SOURCE_FILE_TOO_LARGE]: 413,
      [E.TFT_UNSUPPORTED_FORMAT]: 415,
      [E.TFT_TRACK_TOO_LONG]: 422,
      [E.TFT_RATE_LIMITED]: 429,
    }[err.code] || 500;

    res.status(httpStatus).json(
      buildError(err.code || E.UNKNOWN_ERROR, err.message, err.details || {})
    );
  }
});

/**
 * GET /api/tft/jobs
 * Return local job history.
 */
router.get('/jobs', (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const jobs = jobStore.list(limit);
  res.json({ success: true, jobs });
});

/**
 * GET /api/tft/jobs/:jobId
 * Return a single local job with its current status.
 */
router.get('/jobs/:jobId', (req, res) => {
  const job = jobStore.findById(req.params.jobId);
  if (!job) {
    return res.status(404).json(buildError(E.TFT_NOT_FOUND, `Job not found: ${req.params.jobId}`));
  }
  res.json({ success: true, job });
});

/**
 * POST /api/tft/retry
 * Retry a completed job that has no real timestamps.
 * Deletes the existing LRC, marks old job superseded, re-submits.
 * Body: { job_id: string }
 */
router.post('/retry', async (req, res) => {
  const jobId = req.body && req.body.job_id;
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json(buildError(E.UNKNOWN_ERROR, 'job_id is required'));
  }
  try {
    const result = await retryTranscription(jobId);
    res.status(202).json(result);
  } catch (err) {
    logger.error({ err: err.message, code: err.code }, '/api/tft/retry error');
    const httpStatus = {
      [E.TFT_NOT_FOUND]: 404,
      [E.TFT_TOKEN_MISSING]: 400,
      [E.TFT_UNAUTHORIZED]: 401,
      [E.TFT_INSUFFICIENT_CREDITS]: 402,
      [E.TFT_RATE_LIMITED]: 429,
    }[err.code] || 400;
    res.status(httpStatus).json(buildError(err.code || E.UNKNOWN_ERROR, err.message));
  }
});


/**
 * POST /api/tft/embed
 * Embed the LRC of an already-completed job into the audio file's LYRICS tag.
 * Body: { job_id: string }
 */
router.post('/embed', async (req, res) => {
  const jobId = req.body && req.body.job_id;
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json(buildError(E.UNKNOWN_ERROR, 'job_id is required'));
  }
  const backupRequested = !!(req.body && req.body.backup);
  // onConflict: 'ask' (default — return 409 if backup exists) | 'keep' | 'overwrite'
  const onConflict = (req.body && req.body.backup_conflict) || 'ask';

  try {
    const result = await embedExistingJob(jobId, {
      backup: { enabled: backupRequested, onConflict },
    });
    res.json(result);
  } catch (err) {
    logger.error({ err: err.message, code: err.code }, '/api/tft/embed error');
    const httpStatus = {
      [E.TFT_NOT_FOUND]: 404,
      [E.SOURCE_FILE_NOT_FOUND]: 404,
      [E.LYRICS_EMBED_UNSUPPORTED]: 415,
      [E.LYRICS_EMBED_FAILED]: 500,
      [E.BACKUP_EXISTS]: 409,
    }[err.code] || 400;
    res.status(httpStatus).json(buildError(err.code || E.UNKNOWN_ERROR, err.message, err.details || {}));
  }
});

/**
 * POST /api/tft/reveal
 * Open the enclosing folder of a file in Finder (macOS only).
 * Body: { path: string }
 */
router.post('/reveal', (req, res) => {
  const filePath = req.body && req.body.path;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json(buildError(E.UNKNOWN_ERROR, 'path is required'));
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json(buildError(E.TFT_NOT_FOUND, 'File not found'));
  }
  execFile('open', ['-R', filePath], err => {
    if (err) {
      logger.error({ err: err.message, filePath }, 'reveal: open -R failed');
      return res.status(500).json(buildError(E.UNKNOWN_ERROR, err.message));
    }
    res.json({ success: true });
  });
});

module.exports = router;
