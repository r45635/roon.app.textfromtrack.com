'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Minimal browser globals for the ESM module under client/.
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
global.window = { location: { search: '' } };

let p;
before(async () => {
  p = await import(pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'lib', 'privacy.js')).href);
});

describe('screenshot mode (client/src/lib/privacy.js)', () => {
  test('off: data passes through unchanged', () => {
    p.setPrivacyMode(false);
    const np = { zone_id: 'z1', zone_name: "Vincent's Denon", outputs: [] };
    assert.equal(p.maskNowPlaying(np), np);
    assert.equal(p.maskPath('/Volumes/My Passport/a/b/c.flac'), '/Volumes/My Passport/a/b/c.flac');
  });

  test('on: core, zones, speakers, e-mail and paths become neutral and stable', () => {
    p.setPrivacyMode(true);
    const zones = p.maskZones([
      { zone_id: 'z1', display_name: 'Denon 150 R', outputs: [{ output_id: 'o1', display_name: 'Denon 150 R' }] },
      { zone_id: 'z2', display_name: 'TV Sound Bar', outputs: [] },
    ]);
    assert.deepEqual(zones.map(z => z.display_name), ['Living Room', 'Kitchen']);
    assert.equal(zones[0].outputs[0].display_name, 'Speaker A');
    // Same zone keeps its name wherever it shows up.
    assert.equal(p.maskNowPlaying({ zone_id: 'z1', zone_name: 'Denon 150 R', outputs: [] }).zone_name, 'Living Room');
    assert.equal(p.maskRoonStatus({ core_name: 'vincents-Mac-Studio' }).core_name, 'Roon Core');
    assert.equal(p.maskAccount({ email: 'someone@gmail.com' }).email, 'listener@example.com');
    assert.equal(p.maskPath('/Volumes/My Passport/HiRes Music/The Doors/Alive/07 Moonlight.flac'), '/Music/The Doors/Alive/07 Moonlight.flac');
    p.setPrivacyMode(false);
  });
});
