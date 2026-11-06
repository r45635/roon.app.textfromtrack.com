'use strict';

const fs = require('node:fs');
const os = require('node:os');

// User settings (default zone) go to a temp dir, never the repo's src/storage.
const tmpDir = fs.mkdtempSync(require('node:path').join(os.tmpdir(), 'tft-roon-client-'));
process.env.TFT_USER_DATA_DIR = tmpDir;

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ─── Stub node-roon-api so startRoon() never touches the network ──────────────

const SRC_ROON = path.join(__dirname, '../../src/roon');
const CLIENT_PATH = path.join(SRC_ROON, 'roonClient.js');

let wsConnects;
let discoveryStarts;
let statuses;
let lastRoonApi;

class FakeRoonApi {
  constructor(opts) { this.opts = opts; lastRoonApi = this; }
  init_services() {}
  ws_connect(args) { wsConnects.push(args); return {}; }
  start_discovery() { discoveryStarts += 1; }
}

class FakeRoonApiStatus {
  set_status(msg, isError) { statuses.push({ msg, isError }); }
}

function stubModule(name, exports) {
  const resolved = require.resolve(name, { paths: [SRC_ROON] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stubModule('node-roon-api', FakeRoonApi);
stubModule('node-roon-api-status', FakeRoonApiStatus);
stubModule('node-roon-api-transport', function RoonApiTransport() {});
stubModule('node-roon-api-browse', function RoonApiBrowse() {});

let settingsOpts;
class FakeRoonApiSettings {
  constructor(roon, opts) { settingsOpts = opts; this.updates = []; }
  update_settings(layout) { this.updates.push(layout); }
}
stubModule('node-roon-api-settings', FakeRoonApiSettings);

const config = require('../../src/config');

// roonClient keeps module state — load a fresh copy for each test
function loadClient() {
  delete require.cache[CLIENT_PATH];
  return require(CLIENT_PATH);
}

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

beforeEach(() => {
  wsConnects = [];
  discoveryStarts = 0;
  statuses = [];
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('startRoon — direct connect', () => {
  test('defaults to the Roon 2.x extension port 9330', () => {
    assert.equal(config.roonCorePort, 9330);
  });

  test('connects to ROON_CORE_HOST on the configured port, without discovery', () => {
    config.roonCoreHost = '192.0.2.10';
    config.roonCorePort = 9330;
    loadClient().startRoon();

    assert.equal(wsConnects.length, 1);
    assert.equal(wsConnects[0].host, '192.0.2.10');
    assert.equal(wsConnects[0].port, 9330);
    assert.equal(discoveryStarts, 0);
  });

  test('retries once after a refused connection (onerror then close)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    config.roonCoreHost = '192.0.2.10';
    loadClient().startRoon();

    // A refused WebSocket fires onerror; onclose may follow — only one retry
    wsConnects[0].onerror();
    wsConnects[0].onclose();
    assert.ok(statuses.some(s => s.isError && s.msg.includes('192.0.2.10:9330')));

    t.mock.timers.tick(9999);
    assert.equal(wsConnects.length, 1);
    t.mock.timers.tick(1);
    assert.equal(wsConnects.length, 2);
  });

  test('reconnects after an established connection is lost', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    config.roonCoreHost = '192.0.2.10';
    loadClient().startRoon();

    wsConnects[0].onclose();
    t.mock.timers.tick(10000);
    assert.equal(wsConnects.length, 2);
  });
});

describe('startRoon — discovery', () => {
  test('uses Sood discovery when ROON_CORE_HOST is not set', () => {
    config.roonCoreHost = null;
    loadClient().startRoon();

    assert.equal(discoveryStarts, 1);
    assert.equal(wsConnects.length, 0);
  });

  test('forgets a discovered Core whose connection failed, so the next scan retries', () => {
    config.roonCoreHost = null;
    loadClient().startRoon();

    const roon = lastRoonApi;
    const failed = {};
    const healthy = {};
    roon._sood_conns = { 'core-a': failed, 'core-b': healthy };
    roon.opts.moo_onerror(failed);

    assert.deepEqual(Object.keys(roon._sood_conns), ['core-b']);
  });
});

describe('setActiveZone', () => {
  const nowPlayingStore = require('../../src/roon/nowPlayingStore');

  function pairWith(client, zones) {
    config.roonCoreHost = null;
    client.startRoon();
    let onZones;
    lastRoonApi.opts.core_paired({
      display_name: 'Core', display_version: '2.0', services: {
        RoonApiTransport: { subscribe_zones: (cb) => { onZones = cb; } },
        RoonApiBrowse: {},
      },
    });
    onZones('Subscribed', { zones });
    return (data) => onZones('Changed', data);
  }

  const playing = {
    zone_id: 'z-play', display_name: 'Kitchen', state: 'playing', outputs: [],
    now_playing: { three_line: { line1: 'Song', line2: 'Artist' }, length: 200 },
  };
  const idle = { zone_id: 'z-idle', display_name: 'Living Room', state: 'stopped', outputs: [] };

  test('keeps a chosen zone that has nothing loaded, instead of falling back to a playing one', () => {
    const client = loadClient();
    const changed = pairWith(client, [playing, idle]);
    assert.equal(nowPlayingStore.get()?.zone_id, 'z-play');

    client.setActiveZone('z-idle');
    assert.equal(nowPlayingStore.get(), null);
    assert.deepEqual(client.getAllZones().filter(z => z.is_active).map(z => z.zone_id), ['z-idle']);

    // Another zone's update must not pull the selection away
    changed({ zones_changed: [{ ...playing, now_playing: { ...playing.now_playing, seek_position: 10 } }] });
    assert.deepEqual(client.getAllZones().filter(z => z.is_active).map(z => z.zone_id), ['z-idle']);

    // Something starts in the chosen zone: it shows up
    changed({ zones_changed: [{ ...idle, state: 'playing', now_playing: { three_line: { line1: 'Other', line2: 'Band' } } }] });
    assert.equal(nowPlayingStore.get()?.zone_id, 'z-idle');
    assert.equal(nowPlayingStore.get()?.title, 'Other');
  });

  test('falls back to the automatic zone when the chosen one disappears', () => {
    const client = loadClient();
    const changed = pairWith(client, [playing, idle]);
    client.setActiveZone('z-idle');
    changed({ zones_removed: ['z-idle'] });
    assert.equal(nowPlayingStore.get()?.zone_id, 'z-play');
  });
});

describe('play queue', () => {
  const zoneA = {
    zone_id: 'z-a', display_name: 'Kitchen', state: 'playing', outputs: [],
    now_playing: { three_line: { line1: 'Song', line2: 'Artist' }, length: 200 },
  };
  const zoneB = { ...zoneA, zone_id: 'z-b', display_name: 'Office' };
  const zoneC = { ...zoneA, zone_id: 'z-c', display_name: 'Den' };
  const item = (id, title) => ({
    queue_item_id: id, length: 180, image_key: `img${id}`,
    three_line: { line1: title, line2: 'Band', line3: 'Record' },
  });

  // Pair with a fake transport that records queue subscriptions: zone_id → { cb, unsubscribed }.
  function pair(client, zones, { playResult = { name: 'Success' } } = {}) {
    config.roonCoreHost = null;
    client.startRoon();
    const subs = {};
    const plays = [];
    let onZones;
    lastRoonApi.opts.core_paired({
      display_name: 'Core', display_version: '2.0', services: {
        RoonApiTransport: {
          subscribe_zones: (cb) => { onZones = cb; },
          subscribe_queue: (zone, max, cb) => {
            const sub = { cb, max, unsubscribed: false };
            subs[zone.zone_id] = sub;
            return { unsubscribe: () => { sub.unsubscribed = true; } };
          },
          play_from_here: (zone, id, cb) => { plays.push([zone.zone_id, id]); cb(playResult); },
        },
        RoonApiBrowse: {},
      },
    });
    onZones('Subscribed', { zones });
    return { subs, plays, changed: (data) => onZones('Changed', data) };
  }

  test('subscribes on first use and maps items like now_playing', async () => {
    const client = loadClient();
    const { subs } = pair(client, [zoneA]);
    const queue = client.getQueue('z-a');
    subs['z-a'].cb('Subscribed', { items: [item(1, 'Song'), item(2, 'Next')] });
    assert.deepEqual(await queue, [
      { queue_item_id: 1, title: 'Song', artist: 'Band', album: 'Record', duration_seconds: 180, image_key: 'img1' },
      { queue_item_id: 2, title: 'Next', artist: 'Band', album: 'Record', duration_seconds: 180, image_key: 'img2' },
    ]);
    assert.equal(subs['z-a'].max, 20);
  });

  test('applies Changed insert and remove operations, and emits queue_changed', async () => {
    const client = loadClient();
    const { subs } = pair(client, [zoneA]);
    const seen = [];
    client.events.on('queue_changed', id => seen.push(id));
    const first = client.getQueue('z-a');
    subs['z-a'].cb('Subscribed', { items: [item(1, 'A'), item(2, 'B'), item(3, 'C')] });
    await first;
    subs['z-a'].cb('Changed', { changes: [
      { operation: 'remove', index: 0, count: 1 },
      { operation: 'insert', index: 1, items: [item(4, 'D')] },
    ] });
    assert.deepEqual((await client.getQueue('z-a')).map(i => i.title), ['B', 'D', 'C']);
    assert.deepEqual(seen, ['z-a', 'z-a']);
  });

  test('keeps at most two subscriptions, dropping the least recently used', async () => {
    const client = loadClient();
    const { subs } = pair(client, [zoneA, zoneB, zoneC]);
    for (const id of ['z-a', 'z-b']) {
      const q = client.getQueue(id);
      subs[id].cb('Subscribed', { items: [] });
      await q;
    }
    await client.getQueue('z-a'); // z-a is now more recent than z-b
    const q = client.getQueue('z-c');
    subs['z-c'].cb('Subscribed', { items: [] });
    await q;
    assert.equal(subs['z-b'].unsubscribed, true);
    assert.equal(subs['z-a'].unsubscribed, false);
    assert.deepEqual(client.queueZoneIds().sort(), ['z-a', 'z-c']);
  });

  test('a failed subscription rejects and is retried on the next call', async () => {
    const client = loadClient();
    const { subs } = pair(client, [zoneA]);
    const q = client.getQueue('z-a');
    subs['z-a'].cb('InvalidRequest', {});
    await assert.rejects(q, /InvalidRequest/);
    assert.deepEqual(client.queueZoneIds(), []);
  });

  test('a removed zone is unsubscribed; an unpaired Core forgets every subscription', async () => {
    const client = loadClient();
    const { subs, changed } = pair(client, [zoneA, zoneB]);
    for (const id of ['z-a', 'z-b']) {
      const q = client.getQueue(id);
      subs[id].cb('Subscribed', { items: [] });
      await q;
    }
    changed({ zones_removed: ['z-a'] });
    assert.equal(subs['z-a'].unsubscribed, true);
    lastRoonApi.opts.core_unpaired({ display_name: 'Core' });
    assert.deepEqual(client.queueZoneIds(), []);
    await assert.rejects(client.getQueue('z-b'), /not available/);
  });

  test('playFromHere checks the raw reply of play_from_here', async () => {
    const ok = loadClient();
    const { plays } = pair(ok, [zoneA]);
    await ok.playFromHere('z-a', 7);
    assert.deepEqual(plays, [['z-a', 7]]);

    const failing = loadClient();
    pair(failing, [zoneA], { playResult: { name: 'InvalidItem' } });
    await assert.rejects(failing.playFromHere('z-a', 7), /InvalidItem/);
    await assert.rejects(failing.playFromHere('z-missing', 7), /Zone not found/);
  });

  test('a zone added after subscribing (zones_added) becomes known', () => {
    const client = loadClient();
    const { changed } = pair(client, [zoneA]);
    changed({ zones_added: [zoneB] });
    assert.deepEqual(client.getAllZones().map(z => z.zone_id).sort(), ['z-a', 'z-b']);
  });
});

describe('settings page in Roon', () => {
  const userSettings = require('../../src/settings/userSettings');
  const nowPlayingStore = require('../../src/roon/nowPlayingStore');
  const kitchen = {
    zone_id: 'z-kitchen', display_name: 'Kitchen', state: 'playing', outputs: [{ output_id: 'o-kitchen' }],
    now_playing: { three_line: { line1: 'Song', line2: 'Artist' }, length: 200 },
  };
  const office = {
    zone_id: 'z-office', display_name: 'Office', state: 'paused', outputs: [{ output_id: 'o-office' }],
    now_playing: { three_line: { line1: 'Other', line2: 'Band' }, length: 100 },
  };

  function fakeReq() {
    const req = { replies: [] };
    req.send_complete = (name, body) => req.replies.push({ name, body });
    return req;
  }

  function start(zones) {
    config.roonCoreHost = null;
    const client = loadClient();
    client.startRoon();
    let onZones;
    lastRoonApi.opts.core_paired({
      display_name: 'Core', display_version: '2.0', services: {
        RoonApiTransport: { subscribe_zones: (cb) => { onZones = cb; } },
        RoonApiBrowse: {},
      },
    });
    onZones('Subscribed', { zones });
    return client;
  }

  beforeEach(() => userSettings.set({ default_zone: null, auto_save_lrclib: false }));

  test('the page shows the web address but never the access token', () => {
    config.accessToken = 'secret-token-123';
    try {
      start([kitchen]);
      let layout;
      settingsOpts.get_settings(l => { layout = l; });
      const text = JSON.stringify(layout);
      assert.doesNotMatch(text, /secret-token-123/);
      const { getLanAddress } = require('../../src/utils/lanAddress');
      if (getLanAddress()) {
        assert.match(layout.layout[0].title, new RegExp(`:${config.port}`));
        assert.match(layout.layout[0].title, /access token/);
      } else {
        assert.match(layout.layout[0].title, /no network address/);
      }
      assert.deepEqual(layout.values, { default_zone: null, auto_save_lrclib: 'off' });
    } finally {
      config.accessToken = '';
    }
  });

  test('a dry run validates without saving; an invalid value is NotValid', () => {
    start([kitchen]);
    const dry = fakeReq();
    settingsOpts.save_settings(dry, true, { values: { auto_save_lrclib: 'on' } });
    assert.equal(dry.replies[0].name, 'Success');
    assert.equal(userSettings.get().auto_save_lrclib, false);

    const bad = fakeReq();
    settingsOpts.save_settings(bad, false, { values: { auto_save_lrclib: 'maybe', default_zone: 'z' } });
    assert.equal(bad.replies[0].name, 'NotValid');
    assert.equal(bad.replies[0].body.settings.has_error, true);
    assert.equal(userSettings.get().auto_save_lrclib, false);
  });

  test('a saved default zone is followed, survives a restart, and a web choice still wins', () => {
    let client = start([kitchen, office]);
    assert.equal(nowPlayingStore.get()?.zone_id, 'z-kitchen'); // auto: the playing zone

    const req = fakeReq();
    settingsOpts.save_settings(req, false, { values: { default_zone: { output_id: 'o-office', name: 'Office' }, auto_save_lrclib: 'on' } });
    assert.equal(req.replies[0].name, 'Success');
    assert.deepEqual(userSettings.get().default_zone, { output_id: 'o-office', name: 'Office' });
    assert.equal(userSettings.get().auto_save_lrclib, true);
    assert.equal(nowPlayingStore.get()?.zone_id, 'z-office');

    client = start([kitchen, office]); // restart
    assert.equal(nowPlayingStore.get()?.zone_id, 'z-office');
    assert.deepEqual(client.getAllZones().filter(z => z.is_active).map(z => z.zone_id), ['z-office']);

    client.setActiveZone('z-kitchen');
    assert.equal(nowPlayingStore.get()?.zone_id, 'z-kitchen');
  });

  test('a default zone that is not there falls back to the automatic choice', () => {
    userSettings.set({ default_zone: { output_id: 'o-gone', name: 'Gone' } });
    start([kitchen, office]);
    assert.equal(nowPlayingStore.get()?.zone_id, 'z-kitchen');
  });
});
