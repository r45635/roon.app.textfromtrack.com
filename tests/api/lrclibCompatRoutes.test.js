'use strict';

// GET /api/get — the companion answering in LRCLIB's own shape.
// The point of the endpoint is that a client written against lrclib.net cannot tell the
// difference, so the test checks the wire shape, not our internal one. The important rule:
// a failed server is 502, never the 404 that means "this track has no lyrics".

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-lrclib-compat-'));
process.env.TFT_USER_DATA_DIR = tmpDir;

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let answer;
const lookupPath = require.resolve('../../src/lyrics/lyricsLookup');
require.cache[lookupPath] = {
  id: lookupPath, filename: lookupPath, loaded: true,
  exports: { lookupLyrics: async (q) => answer(q) },
};

let byId;
const clientPath = require.resolve('../../src/lyrics/lrclibClient');
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: { lrclibGet: async (path) => byId(path) },
};

const compatRoutes = require('../../src/api/lrclibCompatRoutes');

let server;
let base;
let asked;

before(async () => {
  const app = express();
  app.use('/api', compatRoutes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  asked = null;
  answer = (q) => { asked = q; return { found: false }; };
  byId = async () => ({ status: 200, body: null });
});

async function get(query) {
  const res = await fetch(`${base}/get?${query}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/get', () => {
  test('answers LRCLIB\'s field names, from LRCLIB\'s query names', async () => {
    answer = (q) => {
      asked = q;
      return { found: true, synced: '[00:01.00] a line', plain: 'a line', instrumental: false,
               trackName: 'Take Me Home', artistName: 'Phil Collins', albumName: 'No Jacket Required' };
    };
    const { status, body } = await get('track_name=Take+Me+Home&artist_name=Phil+Collins&album_name=No+Jacket+Required&duration=353');
    assert.equal(status, 200);
    assert.deepEqual(asked, { title: 'Take Me Home', artist: 'Phil Collins',
                              album: 'No Jacket Required', duration: '353' });
    assert.equal(body.syncedLyrics, '[00:01.00] a line');
    assert.equal(body.plainLyrics, 'a line');
    assert.equal(body.trackName, 'Take Me Home');
    assert.equal(body.albumName, 'No Jacket Required');
    assert.equal(body.duration, 353);
    assert.equal(body.instrumental, false);
  });

  test('an unknown track is a 404 in LRCLIB\'s own words', async () => {
    const { status, body } = await get('track_name=Nope&artist_name=Nobody');
    assert.equal(status, 404);
    assert.deepEqual(body, { code: 404, name: 'TrackNotFound', message: 'Failed to find specified track' });
  });

  test('a server that failed is 502, not a miss', async () => {
    answer = () => ({ found: false, success: false, error: { code: 'LRCLIB_ERROR', message: 'lrclib.net is busy' } });
    const { status, body } = await get('track_name=Nope&artist_name=Nobody');
    assert.equal(status, 502);
    assert.equal(body.error.code, 'LRCLIB_ERROR');
  });

  test('an instrumental track is found, with no words', async () => {
    answer = () => ({ found: true, instrumental: true, synced: null, plain: null });
    const { status, body } = await get('track_name=YYZ&artist_name=Rush');
    assert.equal(status, 200);
    assert.equal(body.instrumental, true);
    assert.equal(body.syncedLyrics, null);
  });

  test('by id: the record in LRCLIB\'s shape, so a server probe recognises us', async () => {
    byId = async (path) => {
      assert.equal(path, '/api/get/1');
      return { status: 200, body: { id: 1, trackName: 'T', artistName: 'A', duration: 210,
                                    plainLyrics: 'words', syncedLyrics: null, instrumental: false } };
    };
    const res = await fetch(`${base}/get/1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, 1);
    assert.equal(body.plainLyrics, 'words');
    assert.equal(body.syncedLyrics, null);
    assert.equal(body.duration, 210);
  });

  test('by id: unknown is 404, a broken server is 502, a non-numeric id is 400', async () => {
    byId = async () => ({ status: 404, body: null });
    assert.equal((await fetch(`${base}/get/999`)).status, 404);
    byId = async () => { throw new Error('lrclib.net is busy'); };
    assert.equal((await fetch(`${base}/get/999`)).status, 502);
    assert.equal((await fetch(`${base}/get/abc`)).status, 400);
  });

  test('without a track or an artist it is a 400, and nothing is looked up', async () => {
    assert.equal((await get('track_name=Alone')).status, 400);
    assert.equal((await get('artist_name=Alone')).status, 400);
    assert.equal(asked, null);
  });
});
