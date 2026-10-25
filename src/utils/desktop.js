'use strict';

const path = require('path');
const { execFile } = require('child_process');

/**
 * Open a folder, or show a file selected in its folder, in the desktop file manager of the
 * machine running the backend (Finder, Explorer, the Linux default). execFile only: a file
 * name like "$(cmd)" must never reach a shell.
 */

function _run(cmd, args, cb) {
  execFile(cmd, args, (err) => {
    // explorer.exe exits with 1 even when it opened the window.
    if (err && process.platform === 'win32' && cmd === 'explorer.exe' && err.code === 1) return cb(null);
    cb(err || null);
  });
}

/** @param {string} dir absolute folder path @param {(err: Error|null) => void} cb */
function openFolder(dir, cb) {
  if (process.platform === 'darwin') return _run('open', [dir], cb);
  if (process.platform === 'win32') return _run('explorer.exe', [dir], cb);
  return _run('xdg-open', [dir], cb);
}

/** @param {string} file absolute file path @param {(err: Error|null) => void} cb */
function revealFile(file, cb) {
  if (process.platform === 'darwin') return _run('open', ['-R', file], cb);
  if (process.platform === 'win32') return _run('explorer.exe', [`/select,${file}`], cb);
  // No portable "select this file" on Linux: open its folder.
  return _run('xdg-open', [path.dirname(file)], cb);
}

module.exports = { openFolder, revealFile };
