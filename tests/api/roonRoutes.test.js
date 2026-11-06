'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-roon-routes-'));
process.env.TFT_USER_DATA_DIR = tmpDir;

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// ─── Stub roonClient (roonRoutes destructures it at load time) ────────────────

const ZONE = { zone_id: 'z', state: 'playing', title: 'Now', artist: 'Band', album: 'Record' };
let roon;

function resetRoon() {
  roon = {
    connected: true,
    zones: { z: ZONE },
    queue: [],
    queueError: null,
    playError: null,
    plays: [],
    browseCalls: [],
    loadCalls: [],
    browseError: null,
  };
}
resetRoon();

const fake = {
  getRoonStatus: () => ({ connected: roon.connected }),
  getImageBase: () => null,
  getAllZones: () => [],
  setActiveZone: () => {},
  getNowPlaying: (id) => roon.zones[id] || null,
  getQueue: async () => { if (roon.queueError) throw new Error(roon.queueError); return roon.queue; },
  playFromHere: async (zoneId, id) => { if (roon.playError) throw new Error(roon.playError); roon.plays.push([zoneId, id]); },
  browseCatalog: async (opts) => { roon.browseCalls.push(opts); if (roon.browseError) throw new Error(roon.browseError); return { action: 'list', list: { title: 'Root', count: 0, level: 0 } }; },
  loadBrowse: async (opts) => { roon.loadCalls.push(opts); if (roon.browseError) throw new Error(roon.browseError); return { items: [], offset: 0, list: { count: 0 } }; },
};
for (const name of ['controlZone', 'seekZone', 'changeVolume', 'muteOutput', 'muteAll', 'pauseAll', 'changeSettings',
  'transferZone', 'groupOutputs', 'ungroupOutputs', 'standbyOutput', 'convenienceSwitchOutput', 'searchRoon', 'playOnZone']) {
  fake[name] = async () => {};
}
const clientPath = require.resolve('../../src/roon/roonClient');
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fake };

const nowPlayingStore = require('../../src/roon/nowPlayingStore');
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

beforeEach(() => {
  resetRoon();
  nowPlayingStore.set(ZONE);
});

async function call(method, route, body) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

describe('GET /queue', () => {
  test('lists the queue with what is known of each track\'s lyrics', async () => {
    roon.queue = [{ queue_item_id: 1, title: 'Now', artist: 'Band', album: 'Record' }];
    const { status, body } = await call('GET', '/queue?zone_id=z');
    assert.equal(status, 200);
    assert.equal(body.zone_id, 'z');
    assert.deepEqual(body.items, [{ queue_item_id: 1, title: 'Now', artist: 'Band', album: 'Record', lyrics: 'unknown' }]);
  });

  test('404 for an unknown zone, 503 when Roon is down or the queue fails', async () => {
    assert.equal((await call('GET', '/queue?zone_id=nope')).status, 404);
    roon.queueError = 'Roon queue did not answer';
    assert.equal((await call('GET', '/queue')).status, 503);
    roon.connected = false;
    nowPlayingStore.clear();
    assert.equal((await call('GET', '/queue')).body.error.code, 'ROON_NOT_CONNECTED');
  });
});

describe('POST /queue/play', () => {
  test('plays from the given item of the zone', async () => {
    const { status } = await call('POST', '/queue/play', { zone_id: 'z', queue_item_id: 42 });
    assert.equal(status, 200);
    assert.deepEqual(roon.plays, [['z', 42]]);
  });

  test('400 without an item id, 404 for an unknown zone, 503 when Roon refuses', async () => {
    assert.equal((await call('POST', '/queue/play', { zone_id: 'z' })).status, 400);
    assert.equal((await call('POST', '/queue/play', { zone_id: 'z', queue_item_id: {} })).status, 400);
    assert.equal((await call('POST', '/queue/play', { zone_id: 'nope', queue_item_id: 1 })).status, 404);
    roon.playError = 'InvalidItem';
    assert.equal((await call('POST', '/queue/play', { zone_id: 'z', queue_item_id: 1 })).status, 503);
  });
});
