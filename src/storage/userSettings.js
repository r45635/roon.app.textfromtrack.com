'use strict';

/**
 * Persistent user settings stored in storage/user-settings.json.
 * These override the corresponding .env values at runtime.
 */

const path = require('path');
const { readJson, writeJson } = require('../utils/fileUtils');

const SETTINGS_PATH = path.join(__dirname, 'user-settings.json');

const DEFAULTS = {
  music_roots: [],
  path_mappings: [],
  embed_lyrics_default: false,
  backup_before_embed_default: true,
  save_lrc_beside_source_default: false,
  tft_token: '',
  webhook_id: '',
  webhook_secret: '',
};

/**
 * Read all user settings. Missing keys fall back to defaults.
 * @returns {{ music_roots: string[], path_mappings: {from:string,to:string}[] }}
 */
function get() {
  const stored = readJson(SETTINGS_PATH, {});
  return { ...DEFAULTS, ...stored };
}

/**
 * Merge and persist updated settings.
 * @param {Partial<typeof DEFAULTS>} updates
 */
function set(updates) {
  const current = get();
  writeJson(SETTINGS_PATH, { ...current, ...updates });
}

module.exports = { get, set };
