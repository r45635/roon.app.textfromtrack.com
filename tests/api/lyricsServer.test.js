'use strict';

// The companion as the lyrics server of other screens: GET /api/get must answer what the
// player would show for the same track — the matched local file first, the user's corrections
// honoured, damaged copies after clean ones — and remember who asked for what so those
// corrections can be made for a song that only played on a panel.
// Real resolver, real matcher; only LRCLIB and the music index are stubbed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-lyrics-server-'));
process.env.TFT_USER_DATA_DIR = path.join(tmpDir, 'data');
const musicDir = path.join(tmpDir, 'music');
fs.mkdirSync(musicDir, { recursive: true });

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const roonPath = require.resolve('../../src/roon/roonClient');
require.cache[roonPath] = {
  id: roonPath, filename: roonPath, loaded: true,
  exports: { getRoonStatus: () => ({ enabled: false, connected: false }), getNowPlaying: () => null },
};

const config = require('../../src/config');
const lrclibClient = require('../../src/lyrics/lrclibClient');
const lrcCache = require('../../src/utils/lrcCache');
const scanner = require('../../src/music/scanner');
const musicRoots = require('../../src/music/musicRoots');
const resolver = require('../../src/lyrics/lyricsResolver');
const screenRequests = require('../../src/lyrics/screenRequests');
const compatRoutes = require('../../src/api/lrclibCompatRoutes');
const lyricsRoutes = require('../../src/api/lyricsRoutes');

const SYNCED = '[00:01.00]First line\n[00:05.50]Second line';
const SIDECAR = '[ar:Josh Woodward]\n[00:02.00]From the file\n[00:06.00]Beside the music';
const DAMAGED = "[00:01.00]j'? prouve\n[00:02.00]doit? tre\n[00:03.00]St?r?o";
const CLEAN_PLAIN = "J'éprouve\nDoit être\nStéréo";
const TRACK = { title: 'Moonlight Drive', artist: 'The Doors', album: 'Alive, She Cried', duration: 332 };
const QUERY = 'track_name=Moonlight+Drive&artist_name=The+Doors&album_name=Alive%2C+She+Cried&duration=332';

let lrclib;
let calls;
let index;
let server;
let base;

before(async () => {
  lrclibClient.getTrack = async (q) => {
    calls.push(['get', q]);
    if (lrclib.error) throw new Error(lrclib.error);
    return lrclib.get;
  };
  lrclibClient.search = async (q) => { calls.push(['search', q]); return lrclib.search; };
  lrclibClient.getById = async (id) => { calls.push(['byId', id]); return lrclib.byId; };
  scanner.loadIndex = () => index;
  musicRoots.getMusicRoots = () => (index.tracks.length ? [musicDir] : []);
  musicRoots.isUnderMusicRoot = (p) => p.startsWith(musicDir + path.sep);

  const app = express();
  app.use(express.json());
  app.use('/api', compatRoutes);
  app.use('/api/lyrics', lyricsRoutes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  lrclib = { get: null, search: [], byId: null, error: null };
  index = { tracks: [] };
  fs.rmSync(config.lrcCacheDir, { recursive: true, force: true });
  fs.rmSync(config.lyricsPrefsPath, { force: true });
  for (const f of fs.readdirSync(musicDir)) fs.rmSync(path.join(musicDir, f));
  resolver._resetMemo();
  screenRequests._reset();
});

async function get(query = QUERY) {
  const res = await fetch(`${base}/get?${query}`);
  return { status: res.status, body: await res.json() };
}

async function post(route, body) {
  const res = await fetch(`${base}/lyrics/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(res.status, 200, `POST ${route}`);
  return res.json();
}

describe('GET /api/get answers from the player\'s chain', () => {
  test('the .lrc beside a matched file wins, and LRCLIB is never asked', async () => {
    const audio = path.join(musicDir, 'moonlight.mp3');
    fs.writeFileSync(audio, '');
    fs.writeFileSync(path.join(musicDir, 'moonlight.lrc'), SIDECAR);
    index = { tracks: [{ path: audio, filename: 'moonlight.mp3', title: TRACK.title, artist: TRACK.artist,
      album: TRACK.album, duration_seconds: TRACK.duration }] };
    lrclib.get = { id: 7, syncedLyrics: SYNCED, plainLyrics: 'x', duration: 332 };

    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.source, 'sidecar');
    assert.equal(body.syncedLyrics, SIDECAR);
    assert.equal(body.plainLyrics, 'From the file\nBeside the music');
    assert.deepEqual(calls, []);
  });

  test('"Wrong lyrics" makes it a miss for the screens too, and undoing it brings them back', async () => {
    lrclib.get = { id: 7, syncedLyrics: SYNCED, plainLyrics: 'First line\nSecond line', duration: 332 };
    assert.equal((await get()).status, 200);

    await post('wrong', { title: TRACK.title, artist: TRACK.artist, album: TRACK.album, wrong: true });
    const marked = await get();
    assert.equal(marked.status, 404);
    assert.equal(marked.body.name, 'TrackNotFound');

    await post('wrong', { title: TRACK.title, artist: TRACK.artist, album: TRACK.album, wrong: false });
    const back = await get();
    assert.equal(back.status, 200);
    assert.equal(back.body.syncedLyrics, SYNCED);
  });

  test('a damaged exact record gives way to a clean copy', async () => {
    lrclib.get = { id: 1, syncedLyrics: DAMAGED, plainLyrics: null, duration: 332 };
    lrclib.search = [{ id: 2, syncedLyrics: null, plainLyrics: CLEAN_PLAIN, duration: 332,
      trackName: TRACK.title, artistName: TRACK.artist, albumName: TRACK.album }];
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.plainLyrics, CLEAN_PLAIN);
    assert.equal(body.syncedLyrics, null);
    assert.equal(body.id, 2);
  });

  test('pasted lyrics and the per-track offset reach the screens', async () => {
    lrclib.get = { id: 7, syncedLyrics: SYNCED, plainLyrics: 'x', duration: 332 };
    await post('custom', { title: TRACK.title, artist: TRACK.artist, album: TRACK.album, lrc: SIDECAR });
    await post('offset', { title: TRACK.title, artist: TRACK.artist, album: TRACK.album, offset_ms: 500 });
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.syncedLyrics, SIDECAR);
    assert.equal(body.source, 'cache');
    assert.equal(body.offsetMs, 500);
  });

  test('a failed LRCLIB is a 502, never a miss', async () => {
    lrclib.error = 'lrclib.net is busy';
    const { status, body } = await get();
    assert.equal(status, 502);
    assert.equal(body.error.code, 'LRCLIB_ERROR');
  });

  test('an instrumental is found, with no words', async () => {
    lrclib.get = { id: 9, instrumental: true, syncedLyrics: null, plainLyrics: null, duration: 332 };
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.instrumental, true);
    assert.equal(body.syncedLyrics, null);
    assert.equal(body.plainLyrics, null);
  });
});

describe('GET /api/lyrics/recent', () => {
  test('lists what the screens asked, newest first, once per track', async () => {
    lrclib.get = { id: 7, syncedLyrics: SYNCED, plainLyrics: 'x', duration: 332 };
    await get();
    const kept = lrclib.get;
    lrclib.get = null; // "Other" has no lyrics anywhere
    await get('track_name=Other&artist_name=Someone');
    lrclib.get = kept;
    await get();

    const res = await fetch(`${base}/lyrics/recent`);
    const { tracks } = await res.json();
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].title, TRACK.title);
    assert.equal(tracks[0].times, 2);
    assert.equal(tracks[0].found, true);
    assert.equal(tracks[0].synced, true);
    assert.equal(tracks[0].duration_seconds, 332);
    assert.equal(tracks[0].track_id, lrcCache.metaId(TRACK.artist, TRACK.title, TRACK.album));
    assert.equal(tracks[1].title, 'Other');
    assert.equal(tracks[1].found, false);
  });

  test('a correction made since the last request shows at once', async () => {
    lrclib.get = { id: 7, syncedLyrics: SYNCED, plainLyrics: 'x', duration: 332 };
    await get();
    await post('wrong', { title: TRACK.title, artist: TRACK.artist, album: TRACK.album, wrong: true });
    await post('offset', { title: TRACK.title, artist: TRACK.artist, album: TRACK.album, offset_ms: -1000 });
    const { tracks } = await (await fetch(`${base}/lyrics/recent`)).json();
    assert.equal(tracks[0].marked_wrong, true);
    assert.equal(tracks[0].offset_ms, -1000);
  });

  test('keeps the last ones only', () => {
    for (let i = 0; i < screenRequests.MAX_ENTRIES + 5; i++) {
      screenRequests.record({ title: `T${i}`, artist: 'A' }, { found: true });
    }
    const tracks = screenRequests.list();
    assert.equal(tracks.length, screenRequests.MAX_ENTRIES);
    assert.equal(tracks[0].title, `T${screenRequests.MAX_ENTRIES + 4}`);
  });
});
