'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const { readJson, writeJson } = require('../utils/fileUtils');

// ─── Load / save helpers ──────────────────────────────────────────────────────

function load() {
  return readJson(config.jobsPath, []);
}

function save(jobs) {
  writeJson(config.jobsPath, jobs);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Persist a new job.
 * @param {object} job
 */
function create(job) {
  const jobs = load();
  jobs.unshift(job); // newest first
  save(jobs);
  logger.debug({ job_id: job.job_id }, 'Job created in store');
}

/**
 * Find a job by ID.
 * @param {string} jobId
 * @returns {object|null}
 */
function findById(jobId) {
  return load().find(j => j.job_id === jobId) || null;
}

/**
 * Update fields on an existing job.
 * @param {string} jobId
 * @param {object} fields
 */
function update(jobId, fields) {
  const jobs = load();
  const idx = jobs.findIndex(j => j.job_id === jobId);
  if (idx === -1) {
    logger.warn({ jobId }, 'jobStore.update: job not found');
    return;
  }
  jobs[idx] = { ...jobs[idx], ...fields };
  save(jobs);
  logger.debug({ job_id: jobId, fields }, 'Job updated in store');
}

/**
 * Return all jobs (newest first), optionally limited.
 * @param {number} [limit]
 */
function list(limit) {
  const jobs = load();
  return limit ? jobs.slice(0, limit) : jobs;
}

/**
 * Record lyrics written into a file from a free source (LRCLIB), so they show in Job History.
 * @param {{ sourceFile: string, lrc: string, title?: string|null, artist?: string|null,
 *   album?: string|null, written: { lrc_file: string|null, lyrics_embedded: boolean,
 *   backup_path: string|null }, auto?: boolean }} info  auto = saved without a click
 */
function recordLyricsSave({ sourceFile, lrc, title = null, artist = null, album = null, written, auto = false }) {
  const { randomUUID } = require('crypto');
  const segmentCount = (lrc.match(/^\[[\d:.]+\]/gm) || []).length;
  const now = new Date().toISOString();
  return create({
    job_id: randomUUID(),
    source_file: sourceFile,
    lrc_file: written.lrc_file,
    title,
    artist,
    album,
    status: 'done',
    source: 'lrclib',
    auto_saved: auto,
    cache_hit: false,
    embed_requested: written.lyrics_embedded,
    force_requested: false,
    lyrics_embedded: written.lyrics_embedded,
    timestamps_requested: 'auto',
    timestamps_mode: null,
    credits_quoted: 0,
    credits_charged: 0,
    segment_count: segmentCount,
    created_at: now,
    completed_at: now,
    has_timestamps: segmentCount > 0,
    has_timestamps_source: 'lrc_content',
    embed_error: null,
    backup_path: written.backup_path || null,
    backup_created: !!written.backup_path,
    error: null,
  });
}

module.exports = { create, findById, update, list, recordLyricsSave };
