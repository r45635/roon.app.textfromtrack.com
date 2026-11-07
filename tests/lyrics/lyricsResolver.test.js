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
    assert.equal(resolver.pickHit([], 332), null);
  });

  test('plain lyrics of the playing recording beat synced lyrics of another one', () => {
    // Yves Duteil, "Le labyrinthe": studio 138 s has plain lyrics, the live 170 s take is synced.
    const hits = [
      { id: 1, trackName: 'Le labyrinthe', albumName: "J'attends", plainLyrics: PLAIN, duration: 138 },
      { id: 2, trackName: 'Le labyrinthe (Live)', albumName: 'Yves Duteil en public', syncedLyrics: SYNCED, duration: 169.7 },
    ];
    assert.equal(resolver.pickHit(hits, { title: 'Le Labyrinthe', duration_seconds: 138 }).id, 1);
    assert.equal(resolver.pickHit(hits.slice(1), { title: 'Le Labyrinthe', duration_seconds: 138 }).id, 2,
      'another recording is still better than nothing');
  });

  test('without a length, the same kind of recording wins over synced', () => {
    const hits = [
      { id: 1, trackName: 'C\'est le mashed potatoes (Live à l\'Olympia)', syncedLyrics: SYNCED, duration: 188 },
      { id: 2, trackName: 'C\'est le mashed potatoes', albumName: "L'idole des jeunes", plainLyrics: PLAIN, duration: 127 },
    ];
    assert.equal(resolver.pickHit(hits, { title: "C'est le mashed potatoes" }).id, 2);
    assert.equal(resolver.pickHit(hits, { title: "C'est le mashed potatoes (Live)" }).id, 1);
  });

  test('a far recording: the closest length first', () => {
    const hits = [
      { id: 1, syncedLyrics: SYNCED, duration: 260 },
      { id: 2, plainLyrics: PLAIN, duration: 212 },
      { id: 3, syncedLyrics: SYNCED, duration: 215 },
    ];
    assert.equal(resolver.pickHit(hits, 200).id, 2);
    assert.deepEqual(resolver.rankHits(hits, 200).map(h => h.id), [2, 3, 1]);
  });

  test('between records of the right length, the same album wins', () => {
    // Louis Chédid, "Révolution (album version)", CD Story, 257 s: the exact record must win
    // over another album's copy that is 0.6 s closer.
    const hits = [
      { id: 1, albumName: 'Bizarre', plainLyrics: PLAIN, duration: 257.3 },
      { id: 2, albumName: 'CD Story', plainLyrics: PLAIN, duration: 257.96 },
    ];
    assert.equal(resolver.pickHit(hits, { album: 'CD Story', duration_seconds: 257 }).id, 2);
    assert.equal(resolver.pickHit(hits, { album: 'cd story!', duration_seconds: 257 }).id, 2, 'case and punctuation folded');
    assert.equal(resolver.pickHit(hits, { duration_seconds: 257 }).id, 1, 'no album: closest length');
  });

  test('rankHits drops duplicates and, unless asked, records without lyrics', () => {
    const hits = [{ id: 1, duration: 100 }, { id: 2, plainLyrics: PLAIN, duration: 100 }, { id: 2, plainLyrics: PLAIN }];
    assert.deepEqual(resolver.rankHits(hits, 100).map(h => h.id), [2]);
    assert.deepEqual(resolver.rankHits(hits, 100, { keepEmpty: true }).map(h => h.id), [1, 2]);
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

  test('keeps the plain exact hit over synced lyrics of another recording', async () => {
    lrclib.get = { id: 1, plainLyrics: PLAIN, duration: 332 };
    lrclib.search = [{ id: 7, trackName: 'Moonlight Drive (Live)', syncedLyrics: SYNCED, duration: 290 }];
    const r = await resolver.resolve(TRACK);
    assert.equal(r.lrclib_id, 1);
    assert.equal(r.synced, false);
  });

  test('an instrumental title is not searched again without "(instrumental)"', async () => {
    const track = { ...TRACK, title: 'Last night (instrumental)' };
    const r = await resolver.resolve(track);
    assert.equal(r.found, false);
    assert.deepEqual(calls.filter(c => c[0] === 'search').map(c => c[1].title), [track.title]);
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

  test('refresh (Retry) asks LRCLIB again despite a remembered miss', async () => {
    await resolver.resolve(TRACK);
    const n = calls.length;
    lrclib.get = { id: 42, syncedLyrics: SYNCED };
    const r = await resolver.resolve(TRACK, { refresh: true });
    assert.ok(calls.length > n);
    assert.equal(r.found, true);
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

describe('markWrong', () => {
  test('a track marked wrong gets no lyrics, from the cache or LRCLIB, until undone', async () => {
    lrcCache.setByMeta(TRACK.artist, TRACK.title, TRACK.album, SYNCED);
    resolver.markWrong(TRACK, true);
    const r = await resolver.resolve(TRACK);
    assert.equal(r.found, false);
    assert.equal(r.marked_wrong, true);
    assert.equal(r.text, null);
    assert.deepEqual(calls, [], 'LRCLIB is not asked');
    assert.equal(resolver.peek(TRACK), 'none');

    resolver.markWrong(TRACK, false);
    const back = await resolver.resolve(TRACK);
    assert.equal(back.text, SYNCED, 'the cached copy is shown again');
    assert.equal(back.marked_wrong, undefined);
  });

  test('marking forgets the picked version; choosing or saving lyrics clears the mark', async () => {
    lrclib.byId = { id: 99, syncedLyrics: SYNCED };
    await resolver.choose(TRACK, 99);
    resolver.markWrong(TRACK, true);
    let r = await resolver.resolve(TRACK);
    assert.equal(r.lrclib_id, null);
    assert.equal(r.marked_wrong, true);

    await resolver.choose(TRACK, 99);
    r = await resolver.resolve(TRACK);
    assert.equal(r.found, true);
    assert.equal(r.lrclib_id, 99);

    resolver.markWrong(TRACK, true);
    resolver.saveCustom(TRACK, PLAIN);
    r = await resolver.resolve(TRACK);
    assert.equal(r.text, PLAIN);
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

  test('a picked version comes back when its cached copy is gone', async () => {
    lrclib.byId = { id: 99, syncedLyrics: SYNCED };
    await resolver.choose(TRACK, 99);
    fs.rmSync(config.lrcCacheDir, { recursive: true, force: true });
    resolver._resetMemo();
    lrclib.get = { id: 5, syncedLyrics: '[00:01.00]Another version' };
    calls = [];
    const r = await resolver.resolve(TRACK);
    assert.equal(r.lrclib_id, 99);
    assert.equal(r.text, SYNCED);
    assert.deepEqual(calls.map(c => c[0]), ['byId']);
  });

  test('choose rejects an unknown record', async () => {
    await assert.rejects(() => resolver.choose(TRACK, 123), { code: 'NOT_FOUND' });
  });

  test('saveCustom replaces the cached lyrics and resets version and offset', async () => {
    lrcCache.setByMeta(TRACK.artist, TRACK.title, TRACK.album, PLAIN);
    resolver.setOffset(TRACK, 800);
    const saved = resolver.saveCustom(TRACK, SYNCED);
    assert.equal(saved.synced, true);
    const r = await resolver.resolve(TRACK);
    assert.equal(r.text, SYNCED);
    assert.equal(r.offset_ms, 0);
    assert.equal(r.lrclib_id, null);
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
