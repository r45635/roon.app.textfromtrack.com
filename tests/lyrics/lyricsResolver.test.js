'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ─── Redirect storage to a temp dir, stub LRCLIB (no network) ─────────────────

let tmpDir;
const config = require('../../src/config');
const lrclibClient = require('../../src/lyrics/lrclibClient');
const lrcCache = require('../../src/utils/lrcCache');
const resolver = require('../../src/lyrics/lyricsResolver');

const SYNCED = '[00:01.00]First line\n[00:05.50]Second line';
const PLAIN = 'First line\nSecond line';
const TRACK = { title: 'Moonlight Drive', artist: 'The Doors', album: 'Alive, She Cried', duration_seconds: 332 };

let calls;
let lrclib; // { get, search, byId } results served by the stub

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-lyrics-test-'));
  config.lrcCacheDir = path.join(tmpDir, 'lrc-cache');
  config.lyricsPrefsPath = path.join(tmpDir, 'lyrics-prefs.json');
  lrclibClient.getTrack = async (q) => { calls.push(['get', q]); return lrclib.get; };
  lrclibClient.search = async (q) => {
    calls.push(['search', q]);
    if (lrclib.searchError) throw new Error(lrclib.searchError);
    return lrclib.search;
  };
  lrclibClient.getById = async (id) => { calls.push(['byId', id]); return lrclib.byId; };
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  lrclib = { get: null, search: [], byId: null };
  fs.rmSync(config.lrcCacheDir, { recursive: true, force: true });
  fs.rmSync(config.lyricsPrefsPath, { force: true });
  resolver._resetMemo();
});

describe('isSynced', () => {
  test('detects LRC timestamps', () => {
    assert.equal(resolver.isSynced(SYNCED), true);
    assert.equal(resolver.isSynced('[ar:The Doors]\n[01:02.345]x'), true);
    assert.equal(resolver.isSynced(PLAIN), false);
    assert.equal(resolver.isSynced(null), false);
  });
});

describe('pickHit', () => {
  test('prefers synced hits close in duration', () => {
    const hits = [
      { id: 1, plainLyrics: PLAIN, duration: 332 },
      { id: 2, syncedLyrics: SYNCED, duration: 200 },
      { id: 3, syncedLyrics: SYNCED, duration: 330 },
    ];
    assert.equal(resolver.pickHit(hits, 332).id, 3);
    assert.equal(resolver.pickHit(hits.slice(0, 2), 332).id, 2);
    assert.equal(resolver.pickHit([], 332), null);
  });
});

describe('simplify', () => {
  test('drops Roon title decorations and keeps the first artist', () => {
    assert.deepEqual(
      resolver.simplify({ title: 'Moonlight Drive (including Horse Latitudes)', artist: 'The Doors' }),
      { title: 'Moonlight Drive', artist: 'The Doors' }
    );
    assert.equal(resolver.simplify({ title: 'Help! - Remastered 2009', artist: 'x' }).title, 'Help!');
    assert.equal(resolver.simplify({ title: 'Song [Live]', artist: 'x' }).title, 'Song');
    assert.equal(resolver.simplify({ title: 'Anti-Hero', artist: 'x' }).title, 'Anti-Hero');
    assert.equal(resolver.simplify({ title: 'x', artist: 'Daft Punk / Pharrell Williams' }).artist, 'Daft Punk');
  });
});

describe('resolve', () => {
  test('missing title or artist resolves to not found without calling LRCLIB', async () => {
    const r = await resolver.resolve({ title: 'x' });
    assert.equal(r.found, false);
    assert.equal(calls.length, 0);
  });

  test('exact synced LRCLIB hit is returned and written to the metadata cache', async () => {
    lrclib.get = { id: 42, syncedLyrics: SYNCED, plainLyrics: PLAIN };
    const r = await resolver.resolve(TRACK);
    assert.equal(r.found, true);
    assert.equal(r.source, 'lrclib');
    assert.equal(r.synced, true);
    assert.equal(r.text, SYNCED);
    assert.equal(r.lrclib_id, 42);
    assert.equal(lrcCache.getByMeta(TRACK.artist, TRACK.title, TRACK.album), SYNCED);
  });

  test('a cached track never calls LRCLIB', async () => {
    lrcCache.setByMeta(TRACK.artist, TRACK.title, TRACK.album, SYNCED);
    const r = await resolver.resolve(TRACK);
    assert.equal(r.source, 'cache');
    assert.equal(r.synced, true);
    assert.equal(calls.length, 0);
  });

  test('exact hit with plain lyrics only falls back to a synced search hit', async () => {
    lrclib.get = { id: 1, plainLyrics: PLAIN };
    lrclib.search = [{ id: 7, syncedLyrics: SYNCED, duration: 331 }];
    const r = await resolver.resolve(TRACK);
    assert.equal(r.lrclib_id, 7);
    assert.equal(r.synced, true);
  });

  test('keeps the plain exact hit when search has nothing synced', async () => {
    lrclib.get = { id: 1, plainLyrics: PLAIN };
    lrclib.search = [{ id: 9, plainLyrics: 'other' }];
    const r = await resolver.resolve(TRACK);
    assert.equal(r.lrclib_id, 1);
    assert.equal(r.synced, false);
    assert.equal(r.text, PLAIN);
  });

  test('retries the search with a simplified title', async () => {
    const track = { ...TRACK, title: 'Moonlight Drive (including Horse Latitudes)' };
    lrclibClient.search = async (q) => {
      calls.push(['search', q]);
      return q.title === 'Moonlight Drive' ? [{ id: 11, syncedLyrics: SYNCED, duration: 332 }] : [];
    };
    try {
      const r = await resolver.resolve(track);
      assert.equal(r.lrclib_id, 11);
      assert.deepEqual(calls.filter(c => c[0] === 'search').map(c => c[1].title), [track.title, 'Moonlight Drive']);
    } finally {
      lrclibClient.search = async (q) => {
        calls.push(['search', q]);
        if (lrclib.searchError) throw new Error(lrclib.searchError);
        return lrclib.search;
      };
    }
  });

  test('a miss is remembered: the second resolve does not call LRCLIB again', async () => {
    const first = await resolver.resolve(TRACK);
    assert.equal(first.found, false);
    assert.equal(first.source, null);
    const n = calls.length;
    await resolver.resolve(TRACK);
    assert.equal(calls.length, n);
  });

  test('concurrent resolves share one LRCLIB round', async () => {
    lrclib.get = { id: 42, syncedLyrics: SYNCED };
    await Promise.all([resolver.resolve(TRACK), resolver.resolve(TRACK), resolver.resolve(TRACK)]);
    assert.equal(calls.filter(c => c[0] === 'get').length, 1);
  });

  test('an LRCLIB error is reported, not thrown', async () => {
    lrclib.searchError = 'socket hang up';
    const r = await resolver.resolve(TRACK);
    assert.equal(r.found, false);
    assert.equal(r.error, 'socket hang up');
  });

  test('instrumental tracks resolve as found with no text', async () => {
    lrclib.get = { id: 5, instrumental: true };
    const r = await resolver.resolve(TRACK);
    assert.equal(r.found, true);
    assert.equal(r.instrumental, true);
    assert.equal(r.text, null);
  });

  test('a local .lrc sidecar wins over cache and LRCLIB', async () => {
    const audio = path.join(tmpDir, 'track.flac');
    fs.writeFileSync(audio, '');
    fs.writeFileSync(path.join(tmpDir, 'track.lrc'), SYNCED);
    lrcCache.setByMeta(TRACK.artist, TRACK.title, TRACK.album, 'cached');
    const r = await resolver.resolve(TRACK, { audioPath: audio });
    assert.equal(r.source, 'sidecar');
    assert.equal(r.text, SYNCED);
    assert.equal(calls.length, 0);
  });
});

describe('choose and setOffset', () => {
  test('choose replaces the cached lyrics and remembers the version', async () => {
    lrcCache.setByMeta(TRACK.artist, TRACK.title, TRACK.album, PLAIN);
    lrclib.byId = { id: 99, syncedLyrics: SYNCED };
    const chosen = await resolver.choose(TRACK, 99);
    assert.equal(chosen.lrclib_id, 99);
    const r = await resolver.resolve(TRACK);
    assert.equal(r.text, SYNCED);
    assert.equal(r.lrclib_id, 99);
  });

  test('choose rejects an unknown record', async () => {
    await assert.rejects(() => resolver.choose(TRACK, 123), { code: 'NOT_FOUND' });
  });

  test('offset is clamped, rounded and returned by resolve', async () => {
    lrcCache.setByMeta(TRACK.artist, TRACK.title, TRACK.album, SYNCED);
    assert.equal(resolver.setOffset(TRACK, 1234), 1230);
    assert.equal((await resolver.resolve(TRACK)).offset_ms, 1230);
    assert.equal(resolver.setOffset(TRACK, 99999), 30000);
    assert.equal(resolver.setOffset(TRACK, 0), 0);
    assert.equal((await resolver.resolve(TRACK)).offset_ms, 0);
  });
});
