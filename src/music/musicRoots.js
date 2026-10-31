'use strict';

const path = require('path');
const config = require('../config');
const userSettings = require('../settings/userSettings');

/**
 * The configured music roots: the UI setting when non-empty, else MUSIC_ROOTS.
 * @returns {string[]}
 */
function getMusicRoots() {
  const settings = userSettings.get();
  return settings.music_roots.length ? settings.music_roots : config.musicRoots;
}

/**
 * True when an absolute, already-resolved path lies under (or is) a music root.
 * @param {string} resolved
 */
function isUnderMusicRoot(resolved) {
  return getMusicRoots().some(r => {
    const root = path.resolve(r);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

module.exports = { getMusicRoots, isUnderMusicRoot };
