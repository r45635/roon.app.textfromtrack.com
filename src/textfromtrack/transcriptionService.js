'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { AppError, E } = require('../utils/normalize');
const tftClient = require('./tftClient');
const jobStore = require('./jobStore');
const lyricsDetector = require('../music/lyricsDetector');
const lyricsEmbedder = require('../music/lyricsEmbedder');
const scanner = require('../music/scanner');
const lrcCache = require('../utils/lrcCache');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate that a file is acceptable for upload.
 * Only checks existence, readability, and format — NOT size.
 * TFT converts the file to mono 128k MP3 server-side and will return 413
 * itself if the result still exceeds its limit.
 */
async function validateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new AppError(E.SOURCE_FILE_NOT_FOUND, `File not found: ${filePath}`);
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    throw new AppError(E.SOURCE_FILE_UNREADABLE, `Cannot read file: ${err.message}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!tftClient.UPLOAD_EXTENSIONS.has(ext)) {
    throw new AppError(
      E.TFT_UNSUPPORTED_FORMAT,
      `Format "${ext}" is not supported. Allowed: ${[...tftClient.UPLOAD_EXTENSIONS].join(', ')}`
    );
  }

  return stat;
}

// ─── Background polling loop ──────────────────────────────────────────────────

/**
 * Poll TFT until the job is done or error, then download and save the LRC.
 * Runs asynchronously (fire-and-forget from startTranscription).
 */
async function _pollAndComplete(jobId, sourcePath, lrcPath, embed = false, embedOptions = {}, force = false, saveBeside = true) {
  const start = Date.now();
  const timeout = config.tftPollTimeoutMs;
  const interval = config.tftPollIntervalMs;

  logger.info({ jobId }, 'Starting background polling for TFT job');

  while (Date.now() - start < timeout) {
    await sleep(interval);

    let remote;
    try {
      remote = await tftClient.getTranscription(jobId);
    } catch (err) {
      logger.error({ jobId, err: err.message }, 'Polling error — will retry');
      continue;
    }

    logger.debug({ jobId, status: remote.status }, 'TFT job poll');

    // Keep the local store's status in sync
    jobStore.update(jobId, { status: remote.status });

    if (remote.status === 'done') {
      jobStore.update(jobId, { status: 'downloading' });
      try {
        await _downloadAndSave(jobId, sourcePath, lrcPath, remote, embed, embedOptions, force, saveBeside);
      } catch (err) {
        logger.error({ jobId, err: err.message }, 'Download/save failed');
        jobStore.update(jobId, {
          status: 'error',
          error: { code: err.code || E.UNKNOWN_ERROR, message: err.message },
        });
      }
      return;
    }

    if (remote.status === 'error') {
      logger.warn({ jobId }, 'TFT job returned error status');
      jobStore.update(jobId, {
        status: 'error',
        error: { code: E.TFT_INTERNAL_ERROR, message: 'TextFromTrack processing failed' },
        completed_at: new Date().toISOString(),
      });
      return;
    }
  }

  // Timeout
  logger.error({ jobId }, 'Polling timeout exceeded');
  jobStore.update(jobId, {
    status: 'error',
    error: { code: E.UNKNOWN_ERROR, message: 'Polling timeout exceeded' },
    completed_at: new Date().toISOString(),
  });
}

async function _downloadAndSave(jobId, sourcePath, lrcPath, remoteJob, embed = false, embedOptions = {}, force = false, saveBeside = true) {
  // Safety: only check / overwrite the LRC file on disk when we actually intend to save it.
  if (saveBeside) {
    if (fs.existsSync(lrcPath)) {
      if (force) {
        try {
          fs.unlinkSync(lrcPath);
          logger.info({ jobId, lrcPath }, 'force=true — deleted existing .lrc before download');
        } catch (err) {
          throw new AppError(E.LRC_WRITE_FAILED, `Cannot delete existing LRC: ${err.message}`);
        }
      } else {
        throw new AppError(E.LRC_ALREADY_EXISTS, `LRC file already exists: ${lrcPath}`);
      }
    }
  }

  logger.info({ jobId, lrcPath, saveBeside }, 'Downloading LRC export from TextFromTrack');
  const lrcContent = await tftClient.downloadExport(jobId, 'lrc');

  // Cache the raw LRC (keyed by path + metadata) so future requests can skip TFT
  const cachedJob = jobStore.findById(jobId);
  lrcCache.setAll(
    sourcePath,
    cachedJob ? cachedJob.artist : null,
    cachedJob ? cachedJob.title : null,
    cachedJob ? cachedJob.album : null,
    lrcContent
  );
  logger.info({ jobId }, 'LRC written to local cache');

  if (saveBeside) {
    try {
      fs.writeFileSync(lrcPath, lrcContent, 'utf8');
    } catch (err) {
      throw new AppError(E.LRC_WRITE_FAILED, `Cannot write LRC file: ${err.message}`);
    }
    logger.info({ jobId, lrcPath }, 'LRC saved successfully');
  } else {
    logger.info({ jobId }, 'saveBeside=false — LRC not written to disk');
  }

  // Count segments from content
  const segmentCount = (lrcContent.match(/^\[[\d:\.]+\]/gm) || []).length;

  // Detect whether timestamps are real or all-zero (fallback model).
  // TFT v1.7+ exposes `has_timestamps` explicitly on GET /segments — that's
  // the authoritative signal. Fall back to the LRC sentinel only if the
  // segments call fails or the field is missing (older API).
  let hasTimestamps;
  let segmentsHasTimestamps = null;
  try {
    const segmentsResp = await tftClient.getSegments(jobId);
    if (segmentsResp && typeof segmentsResp.has_timestamps === 'boolean') {
      segmentsHasTimestamps = segmentsResp.has_timestamps;
    }
  } catch (err) {
    logger.warn({ jobId, err: err.message }, 'Could not fetch /segments — falling back to LRC sentinel for has_timestamps');
  }
  if (segmentsHasTimestamps !== null) {
    hasTimestamps = segmentsHasTimestamps;
  } else {
    hasTimestamps = !lrcContent.includes('--- Timestamps not available for this model ---');
  }

  if (!hasTimestamps) {
    logger.warn({ jobId }, 'LRC saved without real timestamps (fallback model was used)');
  }

  // Optionally embed the LRC into the audio file's LYRICS tag
  let lyricsEmbedded = false;
  let embedError = null;
  let backupInfo = null;
  if (embed) {
    if (!lyricsEmbedder.canEmbed(sourcePath)) {
      embedError = `Embedding not supported for "${path.extname(sourcePath)}"`;
      logger.warn({ jobId, sourcePath }, embedError);
    } else {
      jobStore.update(jobId, { status: 'embedding' });
      try {
        const embedResult = lyricsEmbedder.embedLyrics(sourcePath, lrcContent, {
          backup: embedOptions.backup || { enabled: false },
        });
        lyricsEmbedded = true;
        backupInfo = {
          backup_path: embedResult.backup_path,
          backup_created: embedResult.backup_created,
        };
      } catch (err) {
        embedError = err.message;
        logger.error({ jobId, err: err.message }, 'Failed to embed LYRICS into audio file');
      }
    }
  }

  // Update music index lyrics status
  try {
    let newStatus = null;
    if (lyricsEmbedded) {
      newStatus = lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS;
    } else if (saveBeside) {
      newStatus = lyricsDetector.STATUS.HAS_LRC_FILE;
    }
    if (newStatus) {
      scanner.updateTrackLyricsStatus(sourcePath, newStatus);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not update music index lyrics status');
  }

  jobStore.update(jobId, {
    status: 'done',
    lrc_file: saveBeside ? lrcPath : null,
    has_timestamps: hasTimestamps,
    has_timestamps_source: segmentsHasTimestamps !== null ? 'segments_api' : 'lrc_sentinel',
    lyrics_embedded: lyricsEmbedded,
    embed_error: embedError,
    backup_path: backupInfo ? backupInfo.backup_path : null,
    backup_created: backupInfo ? backupInfo.backup_created : false,
    credits_charged: remoteJob.credits_charged ?? remoteJob.credits_quoted ?? null,
    segment_count: segmentCount,
    completed_at: new Date().toISOString(),
    error: null,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the full transcription flow for a local audio file.
 *
 * Returns immediately after submitting the job to TFT. Background polling
 * continues asynchronously — callers should poll GET /api/tft/jobs/:jobId.
 *
 * @param {string} sourcePath   Absolute local path to the audio file
 * @param {object} trackMeta    { title, artist, album } from the music index
 * @param {object} [options]    { pinyin, vintage, embed }
 * @returns {Promise<{ success: true, job_id: string, status: 'pending' }>}
 */
async function startTranscription(sourcePath, trackMeta = {}, options = {}) {
  const embed = !!options.embed;
  const force = !!options.force;
  const saveBeside = options.saveBeside !== undefined ? !!options.saveBeside : true;
  const backup = options.backup && options.backup.enabled
    ? { enabled: true, onConflict: options.backup.onConflict || 'keep' }
    : { enabled: false };
  // 1. Validate token
  if (!config.tftToken) {
    throw new AppError(E.TFT_TOKEN_MISSING, 'TFT_TOKEN is not configured');
  }

  // 2. Validate file
  await validateFile(sourcePath);

  // 2b. Check local LRC cache (no credit consumed)
  if (!force) {
    const cached = lrcCache.get(sourcePath);
    if (cached) {
      logger.info({ sourcePath }, 'Cache hit — serving LRC from local cache, no TFT credit consumed');
      const lrcPath = lyricsDetector.getLrcPath(sourcePath);
      const cacheJobId = require('crypto').randomUUID();
      const cacheJob = {
        job_id: cacheJobId,
        source_file: sourcePath,
        lrc_file: saveBeside ? lrcPath : null,
        title: trackMeta.title || null,
        artist: trackMeta.artist || null,
        album: trackMeta.album || null,
        status: 'done',
        source: 'cache',
        cache_hit: true,
        embed_requested: embed,
        force_requested: false,
        lyrics_embedded: false,
        timestamps_requested: options.timestamps || 'required',
        timestamps_mode: null,
        credits_quoted: 0,
        credits_charged: 0,
        segment_count: (cached.match(/^\[[\d:\.]+\]/gm) || []).length,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        has_timestamps: !cached.includes('--- Timestamps not available for this model ---'),
        has_timestamps_source: 'lrc_cache',
        embed_error: null,
        backup_path: null,
        backup_created: false,
        error: null,
      };
      if (saveBeside && !fs.existsSync(lrcPath)) {
        try { fs.writeFileSync(lrcPath, cached, 'utf8'); } catch (e) { /* non-fatal */ }
      }
      if (embed && lyricsEmbedder.canEmbed(sourcePath)) {
        try {
          const embedResult = lyricsEmbedder.embedLyrics(sourcePath, cached, {
            backup: backup && backup.enabled ? { enabled: true, onConflict: backup.onConflict || 'keep' } : { enabled: false },
          });
          cacheJob.lyrics_embedded = true;
          cacheJob.backup_path = embedResult.backup_path;
          cacheJob.backup_created = embedResult.backup_created;
        } catch (e) {
          cacheJob.embed_error = e.message;
        }
      }
      jobStore.create(cacheJob);
      return { success: true, job_id: cacheJobId, status: 'done', cache_hit: true };
    }
  }

  // 3. Check current lyrics status (live). Skip the gate when the caller
  //    explicitly forces a re-transcription.
  if (!force) {
    const currentStatus = await lyricsDetector.detect(sourcePath);
    if (
      currentStatus === lyricsDetector.STATUS.HAS_LRC_FILE ||
      currentStatus === lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS
    ) {
      throw new AppError(
        E.LYRICS_ALREADY_EXIST,
        'This track already has local lyrics — skipping'
      );
    }
  } else {
    logger.info({ sourcePath }, 'force=true — skipping lyrics-already-exist guard');
  }

  // 4. Check credit balance
  let me;
  try {
    me = await tftClient.getMe();
  } catch (err) {
    throw err; // propagate auth/network errors
  }
  // credit_available = credit_balance - credit_reserved (held by in-flight TFT jobs)
  // Fall back to credit_balance if the API doesn't provide credit_available.
  const spendable = me.credit_available ?? me.credit_balance;
  if (spendable !== undefined && spendable <= 0) {
    throw new AppError(
      E.TFT_INSUFFICIENT_CREDITS,
      `No credits available to spend (balance: ${me.credit_balance ?? '?'}, reserved: ${me.credit_reserved ?? 0}, available: ${spendable})`,
      {
        top_up_url: me.top_up_url,
        credit_balance: me.credit_balance,
        credit_reserved: me.credit_reserved,
        credit_available: me.credit_available,
      }
    );
  }

  // 5. Submit file
  const result = await tftClient.submitTranscription(sourcePath, options);
  const jobId = result.job_id;

  const lrcPath = lyricsDetector.getLrcPath(sourcePath);

  // 6. Persist job
  const job = {
    job_id: jobId,
    source_file: sourcePath,
    lrc_file: saveBeside ? lrcPath : null,
    title: trackMeta.title || null,
    artist: trackMeta.artist || null,
    album: trackMeta.album || null,
    status: 'pending',
    embed_requested: embed,
    force_requested: force,
    lyrics_embedded: false,
    timestamps_requested: options.timestamps || 'required',
    // The TFT v1.7 response echoes the actually-applied mode; the music-mode
    // server block can re-resolve it (e.g. flip 'auto' → 'required' for music
    // jobs) so we record what the server confirmed, not just what we asked for.
    timestamps_mode: result.timestamps_mode || null,
    credits_quoted: result.credits_quoted ?? null,
    credits_charged: null,
    segment_count: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    error: null,
  };
  jobStore.create(job);

  // 7. Start background polling (fire-and-forget)
  _pollAndComplete(jobId, sourcePath, lrcPath, embed, { backup }, force, saveBeside).catch(err => {
    logger.error({ jobId, err: err.message }, 'Unhandled error in polling loop');
  });

  logger.info({ jobId, sourcePath, embed, backup, force }, 'Transcription job started');

  return { success: true, job_id: jobId, status: 'pending' };
}

/**
 * Retry a completed job that had no real timestamps.
 * Deletes the existing LRC, removes the old job, re-submits.
 *
 * @param {string} jobId  ID of the job to retry
 * @returns {Promise<{ success: true, job_id: string, status: 'pending' }>}
 */
async function retryTranscription(jobId) {
  const job = jobStore.findById(jobId);
  if (!job) {
    throw new AppError(E.TFT_NOT_FOUND, `Job not found: ${jobId}`);
  }
  if (job.status !== 'done') {
    throw new AppError(E.UNKNOWN_ERROR, 'Only completed jobs can be retried');
  }
  if (job.has_timestamps !== false) {
    throw new AppError(E.UNKNOWN_ERROR, 'Job already has real timestamps');
  }

  // Delete the LRC file so the new job can write it
  if (job.lrc_file && fs.existsSync(job.lrc_file)) {
    fs.unlinkSync(job.lrc_file);
    logger.info({ jobId, lrcPath: job.lrc_file }, 'Deleted no-timestamp LRC for retry');
  }

  // Update music index: remove HAS_LRC_FILE status
  try {
    scanner.updateTrackLyricsStatus(job.source_file, lyricsDetector.STATUS.NO_LYRICS);
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not reset music index lyrics status');
  }

  // Mark old job as superseded
  jobStore.update(jobId, { status: 'superseded' });

  return startTranscription(
    job.source_file,
    { title: job.title, artist: job.artist, album: job.album },
    {
      pinyin: config.tftDefaultPinyin,
      vintage: config.tftDefaultVintage,
      embed: !!job.embed_requested,
      saveBeside: !!job.lrc_file, // preserve the original save-beside intent
    }
  );
}

/**
 * Embed the LRC of a completed job into the audio file's LYRICS tag.
 * Used when the user did not request embedding at submission time but
 * wants to do it afterwards from the job history.
 *
 * @param {string} jobId
 * @param {{ backup?: { enabled: boolean, onConflict?: 'ask'|'keep'|'overwrite' } }} [options]
 */
async function embedExistingJob(jobId, options = {}) {
  const job = jobStore.findById(jobId);
  if (!job) {
    throw new AppError(E.TFT_NOT_FOUND, `Job not found: ${jobId}`);
  }
  if (job.status !== 'done') {
    throw new AppError(E.UNKNOWN_ERROR, 'Only completed jobs can be embedded');
  }
  if (job.lyrics_embedded) {
    throw new AppError(E.UNKNOWN_ERROR, 'Lyrics are already embedded for this job');
  }
  if (!job.source_file || !fs.existsSync(job.source_file)) {
    throw new AppError(E.SOURCE_FILE_NOT_FOUND, `Source file missing: ${job.source_file}`);
  }
  if (!job.lrc_file || !fs.existsSync(job.lrc_file)) {
    throw new AppError(E.LRC_WRITE_FAILED, `LRC file missing: ${job.lrc_file}`);
  }
  if (!lyricsEmbedder.canEmbed(job.source_file)) {
    throw new AppError(
      E.LYRICS_EMBED_UNSUPPORTED,
      `Embedding not supported for "${path.extname(job.source_file)}" files`
    );
  }

  const lrcContent = fs.readFileSync(job.lrc_file, 'utf8');
  const backupOpt = options.backup && options.backup.enabled
    ? { enabled: true, onConflict: options.backup.onConflict || 'ask' }
    : { enabled: false };

  const result = lyricsEmbedder.embedLyrics(job.source_file, lrcContent, { backup: backupOpt });

  jobStore.update(jobId, {
    lyrics_embedded: true,
    embed_error: null,
    embed_requested: true,
    backup_path: result.backup_path,
    backup_created: result.backup_created,
  });

  try {
    scanner.updateTrackLyricsStatus(job.source_file, lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS);
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not update music index lyrics status after retroactive embed');
  }

  logger.info({ jobId, format: result.format, backup: result.backup_path }, 'Retroactive lyrics embed succeeded');

  return {
    success: true,
    job_id: jobId,
    lyrics_embedded: true,
    format: result.format,
    backup_path: result.backup_path,
    backup_created: result.backup_created,
  };
}

module.exports = { startTranscription, retryTranscription, embedExistingJob };
