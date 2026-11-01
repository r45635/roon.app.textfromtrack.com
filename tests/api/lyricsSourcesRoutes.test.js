'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-lyrics-sources-'));
process.env.TFT_USER_DATA_DIR = tmpDir;

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const config = require('../../src/config');
const lrclibClient = require('../../src/lyrics/lrclibClient');
const lyricsSourcesRoutes = require('../../src/api/lyricsSourcesRoutes');

let server;
let base;

before(async () => {
  config.lrclibUrls = [];
  const app = express();
  app.use(express.json());
  app.use('/api/lyrics-sources', lyricsSourcesRoutes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/lyrics-sources`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function post(suffix, body) {
  return fetch(`${base}${suffix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/lyrics-sources', () => {
  test('lrclib.net alone by default', async () => {
    const data = await (await fetch(base)).json();
    assert.deepEqual(data, { success: true, urls: ['https://lrclib.net'], source: 'default' });
  });

  test('a list is stored normalized, in order, and read back', async () => {
    const res = await post('', { urls: ['http://192.168.2.57:3300/', 'https://lrclib.net'] });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).urls, ['http://192.168.2.57:3300', 'https://lrclib.net']);
    const data = await (await fetch(base)).json();
    assert.equal(data.source, 'user_settings');
    assert.deepEqual(data.urls, ['http://192.168.2.57:3300', 'https://lrclib.net']);
  });

  test('an invalid entry is refused with its reason, and nothing is stored', async () => {
    const res = await post('', { urls: ['https://lrclib.net', 'ftp://example.com'] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /ftp:\/\/example\.com/);
    assert.deepEqual((await (await fetch(base)).json()).urls, ['http://192.168.2.57:3300', 'https://lrclib.net']);
    assert.equal((await post('', { urls: 'https://lrclib.net' })).status, 400);
  });

  test('an empty list goes back to the default', async () => {
    const data = await (await post('', { urls: [] })).json();
    assert.deepEqual(data, { success: true, urls: ['https://lrclib.net'], source: 'default' });
  });

  test('test: the probe result of that server', async () => {
    const original = lrclibClient.probe;
    lrclibClient.probe = async (url) => ({ ok: true, status: 200, ms: 17, error: null, url });
    try {
      const data = await (await post('/test', { url: 'http://192.168.2.57:3300' })).json();
      assert.equal(data.ok, true);
      assert.equal(data.ms, 17);
      assert.equal((await post('/test', { url: 'not a url' })).status, 400);
    } finally {
      lrclibClient.probe = original;
    }
  });
});
