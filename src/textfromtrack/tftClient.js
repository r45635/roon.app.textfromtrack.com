'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { AppError, E, mapTftError } = require('../utils/normalize');

// ─── Supported extensions for upload ─────────────────────────────────────────

const UPLOAD_EXTENSIONS = new Set(['.mp3', '.wav', '.flac']);
const MAX_DURATION_SECONDS = 10 * 60; // 10 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mask a PAT token for safe logging: "tft_pat_abcd...wxyz"
 * @param {string} token
 * @returns {string}
 */
function maskToken(token) {
  if (!token || token.length < 16) return '***';
  return token.slice(0, 12) + '...' + token.slice(-4);
}

/**
 * Extract a usable error code + message from a TFT API error response body.
 */
function parseTftErrorBody(body, httpStatus) {
  // Custom TFT error shape: { error: { code, message } }
  if (body && typeof body === 'object' && body.error && body.error.code) {
    return { code: mapTftError(body.error.code), message: body.error.message || '' };
  }
  // FastAPI default: { detail: string }
  if (body && typeof body === 'object' && typeof body.detail === 'string') {
    return { code: httpStatusToCode(httpStatus), message: body.detail };
  }
  // FastAPI validation: { detail: [{ loc, msg, type }] }
  if (body && typeof body === 'object' && Array.isArray(body.detail)) {
    const msg = body.detail.map(d => d.msg).join('; ');
    return { code: E.TFT_VALIDATION_ERROR, message: msg };
  }
  // Plain text body — surface up to 200 chars so the user sees what TFT said.
  if (typeof body === 'string' && body.trim()) {
    const trimmed = body.trim().slice(0, 200);
    return { code: httpStatusToCode(httpStatus), message: trimmed };
  }
  return { code: httpStatusToCode(httpStatus), message: `HTTP ${httpStatus}` };
}

function httpStatusToCode(status) {
  const map = {
    401: E.TFT_UNAUTHORIZED,
    402: E.TFT_INSUFFICIENT_CREDITS,
    404: E.TFT_NOT_FOUND,
    410: E.TFT_EXPORT_EXPIRED,
    413: E.SOURCE_FILE_TOO_LARGE,
    422: E.TFT_VALIDATION_ERROR,
    429: E.TFT_RATE_LIMITED,
    500: E.TFT_INTERNAL_ERROR,
  };
  return map[status] || E.UNKNOWN_ERROR;
}

/**
 * Perform an authenticated fetch to the TFT API.
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
async function apiFetch(endpoint, options = {}) {
  const token = config.tftToken;
  if (!token) throw new AppError(E.TFT_TOKEN_MISSING, 'TFT_TOKEN is not configured');

  logger.debug({ endpoint, method: options.method || 'GET', token: maskToken(token) }, 'TFT API request');

  const url = `${config.tftBaseUrl}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';

  let body;
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  if (!response.ok) {
    const { code, message } = parseTftErrorBody(body, response.status);
    logger.warn(
      { endpoint, status: response.status, body },
      'TFT API returned an error'
    );
    throw new AppError(code, message, { http_status: response.status });
  }

  return { ok: true, status: response.status, body };
}

// ─── API methods ──────────────────────────────────────────────────────────────

/**
 * GET /me — Returns the authenticated user's profile and credit balance.
 */
async function getMe() {
  const { body } = await apiFetch('/me');
  return body;
}

/**
 * POST /transcriptions — Submit an audio file for transcription.
 *
 * Always requests `timestamps=required` so the resulting export is usable as
 * an LRC. The TFT API may still re-resolve the model server-side (e.g. via
 * its music-mode block); the value actually applied is returned in the
 * response as `timestamps_mode` and propagated to the caller.
 *
 * @param {string} filePath     Absolute local path to the audio file
 * @param {{ pinyin?: boolean, vintage?: boolean, timestamps?: 'auto'|'required'|'none' }} [options]
 * @returns {Promise<{ job_id: string, status: string, credits_quoted: number, timestamps_mode?: string }>}
 */
async function submitTranscription(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(ext)) {
    throw new AppError(
      E.TFT_UNSUPPORTED_FORMAT,
      `Unsupported format "${ext}". Allowed: ${[...UPLOAD_EXTENSIONS].join(', ')}`
    );
  }

  const stat = fs.statSync(filePath);
  // No client-side size check: TFT converts the file to mono 128k MP3 on
  // its end and will respond with HTTP 413 if the result still exceeds its
  // limit. Let the API decide.

  const {
    pinyin = config.tftDefaultPinyin,
    vintage = config.tftDefaultVintage,
    // Our use case always wants real timestamps for LRC sync. Callers can
    // override (e.g. a future "text-only" mode) by passing 'auto' or 'none'.
    timestamps = 'required',
  } = options;

  const fileBuffer = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const mimeType = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
  }[ext] || 'application/octet-stream';

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
  formData.append('pinyin', String(pinyin));
  formData.append('vintage', String(vintage));
  formData.append('timestamps', String(timestamps));

  logger.info(
    { filePath, size_mb: (stat.size / 1024 / 1024).toFixed(2), timestamps },
    'Submitting file to TextFromTrack'
  );

  const { body } = await apiFetch('/transcriptions', {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type — let fetch set it with the multipart boundary
  });

  // TFT v1.7+ echoes the actually-applied mode in the 201 response. If it's
  // missing, the deployed API is older than v1.7 and our `timestamps` param
  // is being silently ignored — we'll likely get a fallback model with no
  // real timestamps. Loud warning so this is visible in operator logs.
  if (timestamps !== 'auto' && !body.timestamps_mode) {
    logger.warn(
      { requested: timestamps, response_keys: Object.keys(body || {}) },
      'TFT response did not echo timestamps_mode — production API may pre-date v1.7; the timestamps param may be silently ignored, expect has_timestamps=false'
    );
  }

  return body;
}

/**
 * GET /transcriptions/:job_id — Poll the status of a transcription job.
 * @param {string} jobId
 */
async function getTranscription(jobId) {
  const { body } = await apiFetch(`/transcriptions/${jobId}`);
  return body;
}

/**
 * GET /transcriptions/:job_id/segments — Retrieve structured segments.
 * @param {string} jobId
 */
async function getSegments(jobId) {
  const { body } = await apiFetch(`/transcriptions/${jobId}/segments`);
  return body;
}

/**
 * GET /transcriptions/:job_id/export?format=lrc — Download the export file.
 * @param {string} jobId
 * @param {string} [format]  - "lrc" | "srt" | "txt" | "json"
 * @returns {Promise<string>}  Raw file content
 */
async function downloadExport(jobId, format = config.tftDefaultExportFormat) {
  const token = config.tftToken;
  if (!token) throw new AppError(E.TFT_TOKEN_MISSING, 'TFT_TOKEN is not configured');

  const url = `${config.tftBaseUrl}/transcriptions/${jobId}/export?format=${format}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = null; }
    const { code, message } = parseTftErrorBody(parsed, response.status);
    throw new AppError(code, message, { http_status: response.status });
  }

  return response.text();
}

/**
 * DELETE /transcriptions/:id — Delete a transcription job and its exports.
 * @param {string} jobId
 */
async function deleteTranscription(jobId) {
  const { body } = await apiFetch(`/transcriptions/${jobId}`, { method: 'DELETE' });
  return body;
}

/**
 * GET /transcriptions — List transcription jobs.
 * @param {{ page?: number, per_page?: number, status?: string }} [params]
 */
async function listTranscriptions(params = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.per_page) qs.set('per_page', String(params.per_page));
  if (params.status) qs.set('status', params.status);
  const query = qs.toString() ? `?${qs}` : '';
  const { body } = await apiFetch(`/transcriptions${query}`);
  return body;
}

module.exports = {
  getMe,
  submitTranscription,
  getTranscription,
  getSegments,
  downloadExport,
  deleteTranscription,
  listTranscriptions,
  MAX_DURATION_SECONDS,
  UPLOAD_EXTENSIONS,
};
