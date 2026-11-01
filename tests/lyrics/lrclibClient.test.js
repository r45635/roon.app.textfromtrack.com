'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-lrclib-client-'));
process.env.TFT_USER_DATA_DIR = tmpDir;

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const https = require('node:https');

// Fake http.get / https.get: serve queued answers per host — { status, body, headers } or
// { error } (a network failure) — and record each call as "scheme host".
let answers = {};
let calls = [];
function fakeGet(scheme) {
  return (url, opts, cb) => {
    const { host } = new URL(url);
    calls.push(`${scheme} ${host}`);
    const a = (answers[host] || []).shift() || { status: 500, body: {} };
    const req = new EventEmitter();
    req.destroy = () => {};
    setImmediate(() => {
      if (a.error) { req.emit('error', new Error(a.error)); return; }
      const res = new EventEmitter();
      res.statusCode = a.status;
      res.headers = a.headers || {};
      cb(res);
      res.emit('data', Buffer.from(a.raw ?? JSON.stringify(a.body)));
      res.emit('end');
    });
    return req;
  };
}
http.get = fakeGet('http');
https.get = fakeGet('https');

const config = require('../../src/config');
const userSettings = require('../../src/settings/userSettings');
const client = require('../../src/lyrics/lrclibClient');

const MIRROR = 'http://192.168.2.57:3300';
const LRCLIB = 'https://lrclib.net';
const synced = id => ({ status: 200, body: { id, syncedLyrics: '[00:01.00]x' } });
const notFound = { status: 404, body: { name: 'TrackNotFound' } };
const busy = { status: 503, body: { message: 'The server is busy' }, headers: { 'retry-after': '0.3' } };

function servers(urls) {
  userSettings.set({ lrclib_urls: urls });
}

beforeEach(() => {
  answers = {};
  calls = [];
  config.lrclibUrls = [];
  servers([]);
  client.clearCooldowns();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('lrclibClient — lrclib.net alone (default)', () => {
  test('a single 503 is retried once and the second answer is used', async () => {
    answers['lrclib.net'] = [busy, synced(1)];
    const rec = await client.getTrack({ title: 't', artist: 'a' });
    assert.equal(rec.id, 1);
    assert.equal(calls.length, 2);
  });

  test('two 503 in a row raise an error (not "no lyrics")', async () => {
    answers['lrclib.net'] = [busy, { status: 503, body: { message: 'The server is busy' } }];
    await assert.rejects(() => client.search({ title: 't', artist: 'a' }), /^Error: LRCLIB HTTP 503: The server is busy$/);
  });

  test('404 is "not found", without retry', async () => {
    answers['lrclib.net'] = [notFound];
    assert.equal(await client.getTrack({ title: 't', artist: 'a' }), null);
    assert.equal(calls.length, 1);
  });

  test('the User-Agent names the app version', () => {
    assert.match(client.USER_AGENT, /^TextFromTrackRoonCompanion\/\d+\.\d+\.\d+ /);
  });
});

describe('lrclibClient — a mirror first, then lrclib.net', () => {
  beforeEach(() => servers([MIRROR, LRCLIB]));

  test('the mirror answers: lrclib.net is not asked, over plain http', async () => {
    answers['192.168.2.57:3300'] = [synced(7)];
    assert.equal((await client.getTrack({ title: 't', artist: 'a' })).id, 7);
    assert.deepEqual(calls, ['http 192.168.2.57:3300']);
  });

  test('a mirror 404 means "not here": lrclib.net is asked', async () => {
    answers['192.168.2.57:3300'] = [notFound];
    answers['lrclib.net'] = [synced(8)];
    assert.equal((await client.getTrack({ title: 't', artist: 'a' })).id, 8);
    assert.deepEqual(calls, ['http 192.168.2.57:3300', 'https lrclib.net']);
  });

  test('both 404: a miss', async () => {
    answers['192.168.2.57:3300'] = [notFound];
    answers['lrclib.net'] = [notFound];
    assert.equal(await client.getTrack({ title: 't', artist: 'a' }), null);
  });

  test('mirror 404 and lrclib.net busy: an error naming lrclib.net, not a miss', async () => {
    answers['192.168.2.57:3300'] = [notFound];
    answers['lrclib.net'] = [busy, busy];
    await assert.rejects(() => client.getTrack({ title: 't', artist: 'a' }),
      /^Error: lrclib\.net: LRCLIB HTTP 503: The server is busy$/);
  });

  test('both failing: the error names both servers', async () => {
    answers['192.168.2.57:3300'] = [{ error: 'connect ECONNREFUSED 192.168.2.57:3300' }];
    answers['lrclib.net'] = [busy, busy];
    await assert.rejects(() => client.getTrack({ title: 't', artist: 'a' }),
      /^Error: 192\.168\.2\.57:3300: connect ECONNREFUSED .*; lrclib\.net: LRCLIB HTTP 503/);
  });

  test('a busy mirror passes to lrclib.net at once, with no retry', async () => {
    answers['192.168.2.57:3300'] = [busy];
    answers['lrclib.net'] = [synced(9)];
    assert.equal((await client.getTrack({ title: 't', artist: 'a' })).id, 9);
    assert.deepEqual(calls, ['http 192.168.2.57:3300', 'https lrclib.net']);
  });

  test('a mirror 500 (search index building) passes to lrclib.net', async () => {
    answers['192.168.2.57:3300'] = [{ status: 500, body: { name: 'UnknownError' } }];
    answers['lrclib.net'] = [{ status: 200, body: [{ id: 3 }] }];
    assert.deepEqual((await client.search({ title: 't', artist: 'a' })).map(r => r.id), [3]);
  });

  test('a mirror unreachable is skipped for a while, then asked again after clearCooldowns', async () => {
    answers['192.168.2.57:3300'] = [{ error: 'connect EHOSTUNREACH' }];
    answers['lrclib.net'] = [synced(1), synced(2)];
    assert.equal((await client.getTrack({ title: 't', artist: 'a' })).id, 1);
    assert.equal((await client.getTrack({ title: 't', artist: 'a' })).id, 2);
    assert.deepEqual(calls, ['http 192.168.2.57:3300', 'https lrclib.net', 'https lrclib.net']);

    client.clearCooldowns();
    answers['192.168.2.57:3300'] = [synced(3)];
    assert.equal((await client.getTrack({ title: 't', artist: 'a' })).id, 3);
  });

  test('an empty search on the mirror asks lrclib.net; on the last server it is the answer', async () => {
    answers['192.168.2.57:3300'] = [{ status: 200, body: [] }, { status: 200, body: [] }];
    answers['lrclib.net'] = [{ status: 200, body: [{ id: 4 }] }, { status: 200, body: [] }];
    assert.deepEqual((await client.search({ title: 't', artist: 'a' })).map(r => r.id), [4]);
    assert.deepEqual(await client.search({ title: 't', artist: 'a' }), []);
    assert.equal(calls.length, 4);
  });

  test('a mirror answering something that is not LRCLIB JSON passes to lrclib.net', async () => {
    answers['192.168.2.57:3300'] = [{ status: 404, raw: 'not found' }];
    answers['lrclib.net'] = [synced(5)];
    assert.equal((await client.getById(5)).id, 5);
  });

  test('the last server is never skipped, even after a network failure', async () => {
    servers([MIRROR]);
    answers['192.168.2.57:3300'] = [{ error: 'connect EHOSTUNREACH' }, synced(6)];
    await assert.rejects(() => client.getById(6), /^Error: connect EHOSTUNREACH$/);
    assert.equal((await client.getById(6)).id, 6);
  });
});

describe('lrclibClient — server list', () => {
  test('normalizeServerUrl keeps a path prefix and drops the trailing slash', () => {
    assert.equal(client.normalizeServerUrl(' HTTP://192.168.2.57:3300/ '), 'http://192.168.2.57:3300');
    assert.equal(client.normalizeServerUrl('https://example.com/lrclib/'), 'https://example.com/lrclib');
    assert.equal(client.normalizeServerUrl('https://lrclib.net:443'), 'https://lrclib.net');
  });

  test('normalizeServerUrl refuses other schemes, credentials, queries and non-URLs', () => {
    assert.throws(() => client.normalizeServerUrl('ftp://example.com'), /Only http/);
    assert.throws(() => client.normalizeServerUrl('http://user:pw@example.com'), /password/);
    assert.throws(() => client.normalizeServerUrl('http://example.com/?x=1'), /query/);
    assert.throws(() => client.normalizeServerUrl('192.168.2.57:3300'), /Only http|Not a valid URL/);
    assert.throws(() => client.normalizeServerUrl(''), /Not a valid URL/);
  });

  test('normalizeServerList drops duplicates and caps the length', () => {
    assert.deepEqual(client.normalizeServerList([MIRROR, `${MIRROR}/`, LRCLIB]), [MIRROR, LRCLIB]);
    assert.throws(() => client.normalizeServerList(['1', '2', '3', '4', '5', '6'].map(n => `http://h${n}`)), /At most 5/);
  });

  test('precedence: app setting, then LRCLIB_URLS, then lrclib.net', () => {
    assert.deepEqual(client.getServers(), { urls: [LRCLIB], source: 'default' });
    config.lrclibUrls = [MIRROR, 'not a url', LRCLIB];
    assert.deepEqual(client.getServers(), { urls: [MIRROR, LRCLIB], source: 'env' });
    servers(['https://example.com']);
    assert.deepEqual(client.getServers(), { urls: ['https://example.com'], source: 'user_settings' });
  });

  test('probe: an LRCLIB answer is OK, anything else is not', async () => {
    answers['192.168.2.57:3300'] = [synced(1), { status: 404, raw: 'not found' }, { error: 'connect ECONNREFUSED' }];
    assert.equal((await client.probe(MIRROR)).ok, true);
    const html = await client.probe(MIRROR);
    assert.equal(html.ok, false);
    assert.match(html.error, /not an LRCLIB answer/);
    assert.deepEqual(await client.probe(MIRROR).then(r => [r.ok, r.status, r.error]), [false, null, 'connect ECONNREFUSED']);
  });
});
