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
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');
const backendPrefs = require('./backendPrefs');

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

let backendMode = 'local'; // 'local' | 'remote'
let activeBackendURL = UI_URL;
let remoteDisplayName = null;

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
  http.get(`${activeBackendURL}/api/roon/status`, (res) => {
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
  http.get(`${activeBackendURL}/api/tft/me`, (res) => {
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

// ── Remote backend ping ───────────────────────────────────────────────────────
function checkRemoteAlive(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/roon/status`, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── mDNS backend discovery ────────────────────────────────────────────────────
function scanForBackends(timeoutMs) {
  return new Promise((resolve) => {
    let Bonjour;
    try { ({ Bonjour } = require('bonjour-service')); } catch { return resolve([]); }
    const bonjour = new Bonjour();
    const found = [];
    const ownIP = getLocalNetworkIP();
    bonjour.find({ type: 'textfromtrack' }, (service) => {
      const ip = (service.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      if (!ip || ip === '127.0.0.1' || ip === ownIP) return;
      const url = `http://${ip}:${service.port}`;
      if (!found.find(f => f.url === url)) {
        found.push({ url, displayName: `${service.name} (${ip}:${service.port})` });
      }
    });
    setTimeout(() => {
      try { bonjour.destroy(); } catch {}
      resolve(found);
    }, timeoutMs);
  });
}

// ── Remote / local mode switching ─────────────────────────────────────────────
function enterRemoteMode(url, displayName) {
  if (roonTimer) { clearInterval(roonTimer); roonTimer = null; }
  if (creditsTimer) { clearInterval(creditsTimer); creditsTimer = null; }
  backendMode = 'remote';
  activeBackendURL = url;
  remoteDisplayName = displayName;
  serverReady = true;
  roonLabel = 'Connecting to remote…';
  creditsLabel = null;
  startPolling();
  rebuildMenu();
}

function enterLocalMode() {
  if (roonTimer) { clearInterval(roonTimer); roonTimer = null; }
  if (creditsTimer) { clearInterval(creditsTimer); creditsTimer = null; }
  backendMode = 'local';
  activeBackendURL = UI_URL;
  remoteDisplayName = null;
  serverReady = false;
  roonLabel = 'Roon: connecting…';
  creditsLabel = null;
  backendPrefs.write({ backendMode: 'local', remoteUrl: null, remoteDisplayName: null });
  rebuildMenu();
  startServer();
}

async function switchBackend() {
  const found = await scanForBackends(3000);
  if (found.length === 0) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'No backends found',
      message: 'No TextFromTrack backends were found on the local network.',
      detail: 'Make sure TextFromTrack is running on another machine on the same network.',
      buttons: ['OK'],
    });
    return;
  }
  const localIdx = backendMode === 'remote' ? found.length + 1 : -1;
  const buttons = [
    'Cancel',
    ...found.map(b => `Connect: ${b.displayName}`),
    ...(backendMode === 'remote' ? ['Use Local Backend'] : []),
  ];
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Switch Backend',
    message: `Found ${found.length} backend${found.length > 1 ? 's' : ''} on your network`,
    detail: found.map(b => `• ${b.displayName}`).join('\n') + '\n\nSelect a backend to connect to:',
    buttons,
    defaultId: 0,
  });
  if (response === 0) return;
  if (backendMode === 'remote' && response === localIdx) { enterLocalMode(); return; }
  const chosen = found[response - 1];
  backendPrefs.write({ backendMode: 'remote', remoteUrl: chosen.url, remoteDisplayName: chosen.displayName });
  if (backendMode === 'remote') {
    activeBackendURL = chosen.url;
    remoteDisplayName = chosen.displayName;
    roonLabel = 'Connecting to remote…';
    creditsLabel = null;
    if (roonTimer) { clearInterval(roonTimer); roonTimer = null; }
    if (creditsTimer) { clearInterval(creditsTimer); creditsTimer = null; }
    startPolling();
    rebuildMenu();
  } else {
    if (serverProcess) { serverProcess.kill(); serverProcess = null; }
    enterRemoteMode(chosen.url, chosen.displayName);
  }
}

async function initBackend() {
  const prefs = backendPrefs.read();

  // 1. Restore saved remote session if still alive
  if (prefs.backendMode === 'remote' && prefs.remoteUrl) {
    const alive = await checkRemoteAlive(prefs.remoteUrl);
    if (alive) {
      enterRemoteMode(prefs.remoteUrl, prefs.remoteDisplayName || prefs.remoteUrl);
      return;
    }
    // Remote gone — fall through to scan
  }

  // 2. Scan LAN for other backends (skip if user explicitly chose local last time)
  if (prefs.backendMode !== 'local') {
    const found = await scanForBackends(3000);
    if (found.length > 0) {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'TextFromTrack — Backend Found',
        message: `Found ${found.length} TextFromTrack backend${found.length > 1 ? 's' : ''} on your network`,
        detail: found.map(b => `• ${b.displayName}`).join('\n') + '\n\nConnect to a network backend, or start the local backend?',
        buttons: ['Start Local Backend', ...found.map(b => `Connect: ${b.displayName}`)],
        defaultId: 0,
      });
      if (response > 0) {
        const chosen = found[response - 1];
        backendPrefs.write({ backendMode: 'remote', remoteUrl: chosen.url, remoteDisplayName: chosen.displayName });
        enterRemoteMode(chosen.url, chosen.displayName);
        return;
      }
      // User chose local — remember so we skip scan next launch
      backendPrefs.write({ backendMode: 'local', remoteUrl: null, remoteDisplayName: null });
    }
  }

  // 3. Default: local backend
  startServer();
}

// ── Local network IP ─────────────────────────────────────────────────────────
function getLocalNetworkIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
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
      '',
      (() => { const ip = getLocalNetworkIP(); return ip ? `Local network: http://${ip}:${PORT}` : ''; })(),
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
  const loginItem = app.getLoginItemSettings();

  if (backendMode === 'remote') {
    // ── Remote mode ──────────────────────────────────────────────────────────
    items.push({ label: `Remote: ${remoteDisplayName}`, enabled: false });
    items.push({ label: serverReady ? roonLabel : 'Connecting…', enabled: false });
    if (creditsLabel) items.push({ label: creditsLabel, enabled: false });
    items.push({ type: 'separator' });
    items.push({
      label: 'Open Remote UI',
      enabled: serverReady,
      click: () => shell.openExternal(activeBackendURL),
    });
    items.push({
      label: 'Switch Backend…',
      click: () => switchBackend(),
    });
    items.push({
      label: 'Use Local Backend',
      click: () => enterLocalMode(),
    });
    items.push({ type: 'separator' });
    items.push({ label: 'Help — User Guide', click: () => openHelp() });
    items.push({ label: 'About TextFromTrack…', click: () => showAbout() });
    items.push({ type: 'separator' });
    items.push({
      label: 'Start at Login',
      type: 'checkbox',
      checked: loginItem.openAtLogin,
      click: (menuItem) => app.setLoginItemSettings({ openAtLogin: menuItem.checked }),
    });
    items.push({ type: 'separator' });
    items.push({ label: 'Quit TextFromTrack', click: () => app.exit(0) });
  } else {
    // ── Local mode ───────────────────────────────────────────────────────────
    items.push({ label: serverReady ? roonLabel : 'Starting…', enabled: false });
    if (creditsLabel) items.push({ label: creditsLabel, enabled: false });
    items.push({ type: 'separator' });
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
    const localIP = getLocalNetworkIP();
    if (localIP) {
      const networkURL = `http://${localIP}:${PORT}`;
      items.push({
        label: `Open on Network  (${networkURL})`,
        enabled: serverReady,
        click: () => shell.openExternal(networkURL),
      });
      items.push({
        label: 'Show QR Code for Phone…',
        enabled: serverReady,
        click: () => shell.openExternal(`http://localhost:${PORT}/api/qr`),
      });
    }
    items.push({
      label: 'Switch Backend…',
      click: () => switchBackend(),
    });
    items.push({ type: 'separator' });
    items.push({ label: 'Help — User Guide', click: () => openHelp() });
    items.push({ label: 'About TextFromTrack…', click: () => showAbout() });
    items.push({ type: 'separator' });
    items.push({
      label: 'Show Log File…',
      click: () => {
        const logPath = path.join(app.getPath('userData'), 'server.log');
        shell.showItemInFinder ? shell.showItemInFinder(logPath) : shell.openPath(logPath);
      },
    });
    items.push({ type: 'separator' });
    items.push({
      label: 'Start at Login',
      type: 'checkbox',
      checked: loginItem.openAtLogin,
      click: (menuItem) => app.setLoginItemSettings({ openAtLogin: menuItem.checked }),
    });
    items.push({ type: 'separator' });
    items.push({
      label: 'Quit TextFromTrack',
      click: () => {
        if (serverProcess) serverProcess.kill();
        app.exit(0);
      },
    });
  }

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
app.whenReady().then(async () => {
  // Hide from the macOS Dock — this is a tray-only app.
  if (app.dock) app.dock.hide();

  createTray();
  await initBackend();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
