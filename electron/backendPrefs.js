'use strict';

/**
 * Electron-side preferences for backend mode.
 * Stored in <userData>/electron-prefs.json (separate from user-settings.json
 * which belongs to the server process).
 *
 * Schema:
 *   { backendMode: 'local'|'remote', remoteUrl: string|null, remoteDisplayName: string|null,
 *     notifications: boolean, loginItemDefaulted: boolean }
 *   loginItemDefaulted: the first packaged launch turned Start at Login on (fresh install only)
 *   and must never do it again, whatever the person chose since.
 */

const path = require('path');
const fs = require('fs');

function prefsPath() {
  // Lazy-require electron so this module can be loaded before app is ready.
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'electron-prefs.json');
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function write(updates) {
  const p = prefsPath();
  let current = {};
  try { current = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  const merged = { ...current, ...updates };
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  } catch {}
}

module.exports = { read, write };
