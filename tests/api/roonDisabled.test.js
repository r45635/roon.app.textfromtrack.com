'use strict';

// ROON_ENABLED=false — the companion as a lyrics server and nothing else.
// What matters: the Roon routes refuse with their own code instead of blaming a Core that
// was never meant to be reached, /status still answers so a client can learn the mode, and
// nothing changes when the mode is off.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-roon-disabled-'));
process.env.TFT_USER_DATA_DIR = tmpDir;

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const fake = {
  getRoonStatus: () => ({ enabled: config.roonEnabled, connected: false }),
  getImageBase: () => null,
  getAllZones: () => [],
  setActiveZone: () => {},
  getNowPlaying: () => null,
  getQueue: async () => [],
  playFromHere: async () => {},
  browseCatalog: async () => ({}),
  loadBrowse: async () => ({}),
};
for (const name of ['controlZone', 'seekZone', 'changeVolume', 'muteOutput', 'muteAll', 'pauseAll',
  'changeSettings', 'transferZone', 'groupOutputs', 'ungroupOutputs', 'standbyOutput',
  'convenienceSwitchOutput', 'searchRoon', 'playOnZone']) {
  fake[name] = async () => {};
}
const clientPath = require.resolve('../../src/roon/roonClient');
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };

const config = require('../../src/config');
const roonRoutes = require('../../src/api/roonRoutes');

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/roon', roonRoutes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/roon`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => { config.roonEnabled = true; });

async function call(route, method = 'GET') {
  const res = await fetch(`${base}${route}`, { method });
  return { status: res.status, body: await res.json() };
}

describe('ROON_ENABLED=false', () => {
  test('every Roon route refuses with ROON_DISABLED, not with "Core not connected"', async () => {
    config.roonEnabled = false;
    for (const route of ['/zones', '/now-playing', '/queue']) {
      const { status, body } = await call(route);
      assert.equal(status, 503, route);
      assert.equal(body.error.code, 'ROON_DISABLED', route);
      assert.match(body.error.message, /lyrics server/i);
    }
  });

  test('/status still answers, and says the mode', async () => {
    config.roonEnabled = false;
    const { status, body } = await call('/status');
    assert.equal(status, 200);
    assert.equal(body.enabled, false);
  });

  test('with Roon on, the routes answer as they always did', async () => {
    const { status, body } = await call('/zones');
    assert.equal(status, 503);                        // the fake Core is not connected
    assert.equal(body.error.code, 'ROON_NOT_CONNECTED');
  });
});

describe('the switch reads the environment', () => {
  const reload = (value) => {
    const p = require.resolve('../../src/config');
    delete require.cache[p];
    if (value === undefined) delete process.env.ROON_ENABLED;
    else process.env.ROON_ENABLED = value;
    const fresh = require(p);
    delete require.cache[p];
    return fresh.roonEnabled;
  };

  after(() => { delete process.env.ROON_ENABLED; });

  test('off for false, 0, no, off — whatever the case or the spaces', () => {
    for (const v of ['false', '0', 'no', 'off', 'FALSE', ' Off ']) assert.equal(reload(v), false, v);
  });

  test('on by default, and for anything else', () => {
    for (const v of [undefined, '', 'true', '1', 'yes']) assert.equal(reload(v), true, String(v));
  });
});
