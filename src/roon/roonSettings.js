'use strict';

/**
 * The companion's page in Roon → Settings → Extensions → Settings: where to open the web
 * interface, the default zone, and automatic saving of LRCLIB lyrics. Values live in
 * user-settings.json like the web interface's, so both show the same thing.
 *
 * Never shows ACCESS_TOKEN: everyone with a Roon Remote can open this page.
 */

const RoonApiSettings = require('node-roon-api-settings');
const config = require('../config');
const logger = require('../utils/logger');
const userSettings = require('../settings/userSettings');
const { getLanAddress } = require('../utils/lanAddress');

const ON = 'on';
const OFF = 'off';

/** The page's current values, from user-settings.json. */
function currentValues() {
  const s = userSettings.get();
  return {
    default_zone: s.default_zone || null,
    auto_save_lrclib: s.auto_save_lrclib ? ON : OFF,
  };
}

function addressLines() {
  const ip = getLanAddress();
  if (!ip) return ['Web interface: this computer has no network address right now.'];
  const base = `http://${ip}:${config.port}`;
  const lines = [`Web interface: ${base}`, `Lyrics screen (TV, tablet): ${base}/#/lyrics`];
  if (config.accessToken) {
    lines.push('These addresses need the access token: scan the QR code shown by the app on this computer.');
  }
  return lines;
}

/**
 * Roon's layout for these values, with an error on each invalid field.
 * @returns {{ values: object, layout: object[], has_error: boolean }}
 */
function buildLayout(values) {
  const l = { values, layout: [], has_error: false };
  l.layout.push({ type: 'label', title: addressLines().join('\n') });

  const zone = { type: 'zone', title: 'Default zone', setting: 'default_zone' };
  const z = values.default_zone;
  if (z != null && !(typeof z === 'object' && typeof z.output_id === 'string' && z.output_id)) {
    zone.error = 'Pick a zone, or none.';
    l.has_error = true;
  }
  l.layout.push(zone);

  const autoSave = {
    type: 'dropdown',
    title: 'Save LRCLIB lyrics into the music files automatically (needs a music folder)',
    values: [{ title: 'Off', value: OFF }, { title: 'On', value: ON }],
    setting: 'auto_save_lrclib',
  };
  if (values.auto_save_lrclib !== ON && values.auto_save_lrclib !== OFF) {
    autoSave.error = 'Choose On or Off.';
    l.has_error = true;
  }
  l.layout.push(autoSave);
  return l;
}

/**
 * Register the settings service on a RoonApi instance.
 * @param {object} roon RoonApi
 * @param {{ onSaved?: Function }} [opts] called after Roon saved new values
 * @returns {{ service: RoonApiSettings, refresh: Function }} pass `service` in provided_services;
 *   call `refresh()` when the web interface changed one of these values
 */
function createSettingsService(roon, { onSaved } = {}) {
  const service = new RoonApiSettings(roon, {
    get_settings(cb) {
      cb(buildLayout(currentValues()));
    },
    save_settings(req, isDryRun, settings) {
      const values = { ...currentValues(), ...((settings && settings.values) || {}) };
      const l = buildLayout(values);
      req.send_complete(l.has_error ? 'NotValid' : 'Success', { settings: l });
      if (isDryRun || l.has_error) return;
      const z = values.default_zone;
      userSettings.set({
        default_zone: z ? { output_id: z.output_id, name: z.name || null } : null,
        auto_save_lrclib: values.auto_save_lrclib === ON,
      });
      logger.info({ default_zone: z ? z.name || z.output_id : null, auto_save_lrclib: values.auto_save_lrclib }, 'Settings saved from Roon');
      service.update_settings(l);
      if (onSaved) onSaved();
    },
    // The page has no buttons; answer anyway so an unexpected call can't throw.
    button_pressed(req) {
      req.send_complete('Success');
    },
  });
  return {
    service,
    refresh: () => service.update_settings(buildLayout(currentValues())),
  };
}

module.exports = { createSettingsService, buildLayout, currentValues };
