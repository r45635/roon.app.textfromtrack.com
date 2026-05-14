'use strict';

/**
 * Electron main process — TextFromTrack Roon Companion
 *
 * Tray-only design: Electron acts as the daemon that:
 *  1. Spawns the Express server (src/server.js) as a child process.
 *  2. Puts an icon in the menu bar (macOS) or system tray (Windows / Linux).
 *  3. Opens the web UI in the user's default browser on request.
 *
 * No BrowserWindow is created — the UI lives at http://localhost:3888.
 */

const { app, Tray, Menu, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

// ── Keep the app alive in the tray when all windows are closed ──────────────
app.on('window-all-closed', (e) => {
  // Prevent default quit — we live in the tray.
});

// ── Single-instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3888;
const UI_URL = `http://localhost:${PORT}`;
const POLL_ROON_MS = 5_000;
const POLL_CREDITS_MS = 60_000;

// ── State ────────────────────────────────────────────────────────────────────
let tray = null;
let serverProcess = null;
let serverReady = false;

let roonLabel = 'Roon: connecting…';
let creditsLabel = null; // null = TFT token not configured yet

// ── Resolve server entry point ───────────────────────────────────────────────
// In a packaged asar build, __dirname is inside the asar. The server is
// extracted to app.getAppPath() via electron-builder's extraResources/asar.
// In dev mode, __dirname is <project root>/electron/.
const serverEntry = app.isPackaged
  ? path.join(process.resourcesPath, 'app', 'src', 'server.js')
  : path.join(__dirname, '..', 'src', 'server.js');

// ── Start the Express server as a child process ──────────────────────────────
function startServer() {
  // In packaged builds Electron bundles Node; we use its own execPath with
  // ELECTRON_RUN_AS_NODE=1 so it behaves like a plain Node.js process.
  // asar: false in electron-builder.yml ensures serverEntry is a real file
  // on disk (not inside a virtual .asar archive) so spawn() can read it.
  const exec = process.execPath;
  const args = [serverEntry];

  const userData = app.getPath('userData');

  // Write server stdout/stderr to a log file — critical for diagnosing crashes
  // in packaged apps where there is no visible terminal.
  const logPath = path.join(userData, 'server.log');
  let logFd;
  try {
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
    logFd = fs.openSync(logPath, 'a');
  } catch (e) {
    logFd = 'inherit';
  }

  serverProcess = spawn(exec, args, {
    cwd: userData, // node-roon-api writes config.json relative to cwd
    env: {
      ...process.env,
      // Point writable storage at the OS user-data folder so it survives updates.
      TFT_USER_DATA_DIR: userData,
      PORT: String(PORT),
      ELECTRON_RUN_AS_NODE: '1',
      // Force production mode so pino does NOT use pino-pretty's worker thread,
      // which can crash silently inside a packaged Electron environment.
      NODE_ENV: app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development'),
    },
    stdio: ['ignore', logFd, logFd],
  });

  serverProcess.on('error', (err) => {
    dialog.showErrorBox(
      'TextFromTrack — Server error',
      `${err.message}\n\nLog: ${logPath}`
    );
  });

  serverProcess.on('exit', (code) => {
    if (typeof logFd === 'number') { try { fs.closeSync(logFd); } catch {} }
    if (code !== 0 && code !== null) {
      // Read last 2 KB of log to show in the error dialog
      let tail = '';
      try {
        const stat = fs.statSync(logPath);
        const buf = Buffer.alloc(2048);
        const fd2 = fs.openSync(logPath, 'r');
        const offset = Math.max(0, stat.size - 2048);
        const n = fs.readSync(fd2, buf, 0, 2048, offset);
        fs.closeSync(fd2);
        tail = buf.slice(0, n).toString('utf8');
      } catch {}
      dialog.showErrorBox(
        `TextFromTrack — Server crashed (exit ${code})`,
        `Log: ${logPath}\n\n${tail || '(no output)'}`
      );
    }
    serverProcess = null;
    serverReady = false;
    rebuildMenu();
  });

  // Poll until the HTTP server is actually accepting connections.
  waitForServer();
}

function waitForServer(attempt = 0) {
  http.get(`${UI_URL}/api/roon/status`, (res) => {
    res.resume();
    serverReady = true;
    rebuildMenu();
    startPolling();
  }).on('error', () => {
    if (attempt < 30) {
      setTimeout(() => waitForServer(attempt + 1), 500);
    }
  });
}

// ── Polling: Roon status ─────────────────────────────────────────────────────
function pollRoon() {
  if (!serverReady) return;
  http.get(`${UI_URL}/api/roon/status`, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.connected && json.core_name) {
          roonLabel = `Roon: ${json.core_name}`;
        } else if (json.state === 'discovered') {
          roonLabel = 'Roon: authorizing…';
        } else {
          roonLabel = 'Roon: not connected';
        }
      } catch {
        roonLabel = 'Roon: —';
      }
      rebuildMenu();
    });
  }).on('error', () => {
    roonLabel = 'Roon: server offline';
    rebuildMenu();
  });
}

// ── Polling: TFT credits ─────────────────────────────────────────────────────
function pollCredits() {
  if (!serverReady) return;
  http.get(`${UI_URL}/api/tft/me`, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.token_configured === false) {
          creditsLabel = null; // hide the credits item if no token
        } else if (json.account?.credit_balance != null) {
          creditsLabel = `Credits: ${json.account.credit_balance}`;
        } else {
          creditsLabel = null;
        }
      } catch {
        creditsLabel = null;
      }
      rebuildMenu();
    });
  }).on('error', () => {
    creditsLabel = null;
  });
}

let roonTimer = null;
let creditsTimer = null;

function startPolling() {
  pollRoon();
  pollCredits();
  if (!roonTimer) roonTimer = setInterval(pollRoon, POLL_ROON_MS);
  if (!creditsTimer) creditsTimer = setInterval(pollCredits, POLL_CREDITS_MS);
}

// ── About dialog ─────────────────────────────────────────────────────────────
function showAbout() {
  const pkg = (() => { try { return require('../package.json'); } catch { return {}; } })();
  const version = pkg.version || 'unknown';
  // Build date: prefer the SOURCE_DATE_EPOCH env var injected by CI, else file mtime.
  let releaseDate = '';
  try {
    const pkgPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'package.json')
      : path.join(__dirname, '..', 'package.json');
    const mtime = fs.statSync(pkgPath).mtime;
    releaseDate = mtime.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {}

  dialog.showMessageBox({
    type: 'info',
    title: 'About TextFromTrack Roon Companion',
    message: `TextFromTrack Roon Companion`,
    detail: [
      `Version: ${version}`,
      releaseDate ? `Released: ${releaseDate}` : '',
      '',
      'GitHub: https://github.com/r45635/roon.app.textfromtrack.com',
    ].filter(l => l !== undefined).join('\n'),
    buttons: ['OK', 'Open GitHub'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 1) {
      shell.openExternal('https://github.com/r45635/roon.app.textfromtrack.com');
    }
  });
}

// ── Help — open local user guide ─────────────────────────────────────────────
function openHelp() {
  const guidePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'docs', 'user-guide.html')
    : path.join(__dirname, '..', 'docs', 'user-guide.html');
  shell.openPath(guidePath);
}

// ── Tray menu ────────────────────────────────────────────────────────────────
function rebuildMenu() {
  if (!tray) return;

  const items = [];

  // Status items (non-clickable)
  items.push({
    label: serverReady ? roonLabel : 'Starting…',
    enabled: false,
  });

  if (creditsLabel) {
    items.push({ label: creditsLabel, enabled: false });
  }

  items.push({ type: 'separator' });

  // Open UI
  items.push({
    label: 'Open UI',
    click: () => {
      if (serverReady) {
        shell.openExternal(UI_URL);
      } else {
        dialog.showMessageBox({ message: 'The server is still starting. Please wait a moment.' });
      }
    },
  });

  items.push({ type: 'separator' });

  // Help & About
  items.push({
    label: 'Help — User Guide',
    click: () => openHelp(),
  });

  items.push({
    label: 'About TextFromTrack…',
    click: () => showAbout(),
  });

  items.push({ type: 'separator' });

  // Show log file
  items.push({
    label: 'Show Log File…',
    click: () => {
      const logPath = path.join(app.getPath('userData'), 'server.log');
      shell.showItemInFinder ? shell.showItemInFinder(logPath) : shell.openPath(logPath);
    },
  });

  items.push({ type: 'separator' });

  // Start at login toggle
  const loginItem = app.getLoginItemSettings();
  items.push({
    label: 'Start at Login',
    type: 'checkbox',
    checked: loginItem.openAtLogin,
    click: (menuItem) => {
      app.setLoginItemSettings({ openAtLogin: menuItem.checked });
    },
  });

  items.push({ type: 'separator' });

  items.push({
    label: 'Quit TextFromTrack',
    click: () => {
      if (serverProcess) serverProcess.kill();
      app.exit(0);
    },
  });

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ── Tray icon ─────────────────────────────────────────────────────────────────
function createTray() {
  const iconName = process.platform === 'darwin' ? 'tray-icon-mac.png' : 'tray-icon.png';
  const iconPath = path.join(__dirname, 'assets', iconName);

  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    // macOS: template image follows system dark/light mode automatically
    if (process.platform === 'darwin') icon.setTemplateImage(true);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('TextFromTrack Roon Companion');

  // Left-click on macOS shows context menu; double-click on Windows opens UI.
  tray.on('double-click', () => {
    if (serverReady) shell.openExternal(UI_URL);
  });

  rebuildMenu(); // initial state: Starting…
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Hide from the macOS Dock — this is a tray-only app.
  if (app.dock) app.dock.hide();

  createTray();
  startServer();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
