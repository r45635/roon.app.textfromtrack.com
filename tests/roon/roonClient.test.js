'use strict';

const { test, describe, beforeEach } = require('node:test');
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

const config = require('../../src/config');

// roonClient keeps module state — load a fresh copy for each test
function loadClient() {
  delete require.cache[CLIENT_PATH];
  return require(CLIENT_PATH);
}

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
