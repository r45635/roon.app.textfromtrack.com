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

module.exports = { create, findById, update, list };
