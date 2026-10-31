'use strict';

/**
 * Persistent user settings stored in storage/user-settings.json.
 * These override the corresponding .env values at runtime.
 */

const path = require('path');
const { readJson, writeJson } = require('../utils/fileUtils');

// Never put code in src/storage: Docker users mount their data folder over it.
// In Electron packaged builds TFT_USER_DATA_DIR points to app.getPath('userData')
// so settings survive updates and never write into the read-only asar.
const SETTINGS_PATH = process.env.TFT_USER_DATA_DIR
  ? path.join(process.env.TFT_USER_DATA_DIR, 'storage', 'user-settings.json')
  : path.join(__dirname, '..', 'storage', 'user-settings.json');

const DEFAULTS = {
  music_roots: [],
  embed_lyrics_default: false,
  backup_before_embed_default: true,
  save_lrc_beside_source_default: false,
  // Write synced LRCLIB lyrics into the playing track's file when it has none.
  auto_save_lrclib: false,
  tft_token: '',
  webhook_id: '',
  webhook_secret: '',
};

/**
 * Read all user settings. Missing keys fall back to defaults.
 * @returns {typeof DEFAULTS}
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

/**
 * Resolve the write flags of a lyrics save: an explicit body value wins, else the user default.
 * The single place these defaults are read, so every route treats a missing setting the same way
 * (backup defaults to on, embed and save-beside to off).
 * @param {object} [body] request body with optional embed / backup / save_beside
 * @returns {{ embed: boolean, backup: boolean, saveBeside: boolean }}
 */
function resolveWriteFlags(body) {
  const settings = get();
  const has = (key) => !!body && Object.prototype.hasOwnProperty.call(body, key);
  return {
    embed: has('embed') ? !!body.embed : !!settings.embed_lyrics_default,
    backup: has('backup') ? !!body.backup : settings.backup_before_embed_default !== false,
    saveBeside: has('save_beside') ? !!body.save_beside : !!settings.save_lrc_beside_source_default,
  };
}

module.exports = { get, set, resolveWriteFlags };
