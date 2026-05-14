'use strict';

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
function dirSizeBytes(dirPath) {
  let total = 0;
  try {
    const walk = (p) => {
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) { try { total += fs.statSync(full).size; } catch {} }
      }
    };
    walk(dirPath);
  } catch {}
  return total;
}

function countFiles(dirPath, ext) {
  let count = 0;
  try {
    const walk = (p) => {
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && (!ext || entry.name.endsWith(ext))) count++;
      }
    };
    walk(dirPath);
  } catch {}
  return count;
}

function toMB(bytes) { return Math.round(bytes / 1024 / 1024 * 10) / 10; }

// ── GET /api/debug/logs?lines=N ───────────────────────────────────────────────
// Returns the tail of server.log. Path is hardcoded to the Electron userData dir
// (TFT_USER_DATA_DIR env var) — no user-supplied paths accepted.
router.get('/logs', (req, res) => {
  const userData = process.env.TFT_USER_DATA_DIR;
  if (!userData) {
    // Dev mode — Electron not running, no log file
    return res.json({ success: true, available: false, message: 'TFT_USER_DATA_DIR not set (dev mode)' });
  }

  const logPath = path.join(userData, 'server.log');
  const maxLines = 1000;
  const requested = parseInt(req.query.lines, 10);
  const lines = (!isNaN(requested) && requested > 0) ? Math.min(requested, maxLines) : 200;

  let raw;
  try {
    raw = fs.readFileSync(logPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ success: true, available: true, content: '', logPath, totalLines: 0, truncated: false, message: 'Log file not yet created' });
    }
    return res.status(500).json({ success: false, error: err.message });
  }

  const allLines = raw.split('\n');
  const totalLines = allLines.length;
  const truncated = totalLines > lines;
  const content = truncated ? allLines.slice(-lines).join('\n') : raw;

  res.json({ success: true, available: true, content, logPath, totalLines, truncated, lines });
});

// ── GET /api/debug/info ───────────────────────────────────────────────────────
// Returns runtime info useful for remote diagnosis and system metrics.
router.get('/info', (req, res) => {
  const userData = process.env.TFT_USER_DATA_DIR;
  const pkg = (() => {
    try { return require('../../package.json'); } catch { return {}; }
  })();

  // Disk metrics — compute only if userData is set (Electron mode)
  let userDataSizeMB = null;
  let lrcCacheSizeMB = null;
  let lrcCacheCount = null;
  if (userData) {
    userDataSizeMB = toMB(dirSizeBytes(userData));
    const cacheDir = path.join(userData, 'storage', 'lrc-cache');
    lrcCacheSizeMB = toMB(dirSizeBytes(cacheDir));
    lrcCacheCount = countFiles(cacheDir, '.lrc');
  }

  res.json({
    success: true,
    version: pkg.version || 'unknown',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: Math.round(process.uptime()),
    logPath: userData ? path.join(userData, 'server.log') : null,
    userDataDir: userData || null,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    hostname: os.hostname(),
    userDataSizeMB,
    lrcCacheSizeMB,
    lrcCacheCount,
  });
});

module.exports = router;
