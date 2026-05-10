'use strict';

require('dotenv').config();
const path = require('path');

/**
 * Parse PATH_MAPPINGS env var into an array of {from, to} objects.
 * Format: "from1=to1,from2=to2"
 */
function parseMappings(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map(pair => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return null;
      return {
        from: pair.slice(0, idx).trim(),
        to: pair.slice(idx + 1).trim(),
      };
    })
    .filter(Boolean);
}

const config = {
  // ── Server ──────────────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT || '3888', 10),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3888',
  nodeEnv: process.env.NODE_ENV || 'development',

  // ── Roon ────────────────────────────────────────────────────────────────────
  roonExtensionId:
    process.env.ROON_EXTENSION_ID || 'com.textfromtrack.roon.companion',
  roonDisplayName:
    process.env.ROON_DISPLAY_NAME || 'TextFromTrack Roon Companion',
  roonDisplayVersion: process.env.ROON_DISPLAY_VERSION || '0.1.0',
  roonPublisher: process.env.ROON_PUBLISHER || 'TextFromTrack',

  // ── Music library ───────────────────────────────────────────────────────────
  musicRoots: (process.env.MUSIC_ROOTS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  pathMappings: parseMappings(process.env.PATH_MAPPINGS),

  // ── TextFromTrack API ───────────────────────────────────────────────────────
  tftBaseUrl:
    process.env.TFT_BASE_URL || 'https://app.textfromtrack.com/api/v1',
  tftToken: process.env.TFT_TOKEN || '',
  tftDefaultExportFormat: process.env.TFT_DEFAULT_EXPORT_FORMAT || 'lrc',
  tftDefaultPinyin: process.env.TFT_DEFAULT_PINYIN === 'true',
  tftDefaultVintage: process.env.TFT_DEFAULT_VINTAGE === 'true',

  // ── Polling ─────────────────────────────────────────────────────────────────
  tftPollIntervalMs: parseInt(process.env.TFT_POLL_INTERVAL_MS || '2000', 10),
  tftPollTimeoutMs: parseInt(
    process.env.TFT_POLL_TIMEOUT_MS || '600000',
    10
  ),

  // ── Storage ─────────────────────────────────────────────────────────────────
  storageDir: path.join(__dirname, 'storage'),
  musicIndexPath: path.join(__dirname, 'storage', 'music-index.json'),
  jobsPath: path.join(__dirname, 'storage', 'jobs.json'),

  // ── Logging ─────────────────────────────────────────────────────────────────
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
