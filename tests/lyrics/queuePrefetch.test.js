'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-queue-prefetch-'));
process.env.TFT_USER_DATA_DIR = tmpDir;

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const config = require('../../src/config');
config.lrcCacheDir = path.join(tmpDir, 'lrc-cache');
const lrcCache = require('../../src/utils/lrcCache');
const resolver = require('../../src/lyrics/lyricsResolver');
const prefetch = require('../../src/lyrics/queuePrefetch');

const track = (id, title) => ({ queue_item_id: id, title, artist: 'Band', album: 'Record', duration_seconds: 200 });
const NOW = { zone_id: 'z', state: 'playing', title: 'Now', artist: 'Band', album: 'Record' };

// A fake roonClient with one playing zone and its queue (the playing track first).
function fakeRoon(queue, np = NOW) {
  return {
    events: new EventEmitter(),
    getNowPlaying: () => np,
    getQueue: async () => queue,
    queueZoneIds: () => [],
  };
}

let looked;
let sleeps;
function deps(results = {}) {
  return {
    store: { get: () => NOW },
    sleep: async (ms) => { sleeps.push(ms); },
    lookup: async (t) => {
      looked.push(t.title);
      const r = results[t.title];
      if (r instanceof Error) throw r;
      return { lyrics: r || { found: true, synced: true, text: '[00:01.00]x', source: 'lrclib' } };
    },
  };
}

beforeEach(() => {
  looked = [];
  sleeps = [];
  fs.rmSync(config.lrcCacheDir, { recursive: true, force: true });
  resolver._resetMemo();
  prefetch._resetSeen();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('queuePrefetch', () => {
  test('looks up only the next 3 tracks after the playing one, one second apart', async () => {
    const queue = [track(1, 'Now'), track(2, 'A'), track(3, 'B'), track(4, 'C'), track(5, 'D')];
    await prefetch.createPrefetcher(fakeRoon(queue), deps()).prefetchZone('z');
    assert.deepEqual(looked, ['A', 'B', 'C']);
    assert.deepEqual(sleeps, [prefetch.PAUSE_MS, prefetch.PAUSE_MS]);
  });

  test('skips tracks already in the cache, and remembers what it found', async () => {
    lrcCache.setByMeta('Band', 'A', 'Record', '[00:01.00]cached');
    const queue = [track(1, 'Now'), track(2, 'A'), track(3, 'B')];
    await prefetch.createPrefetcher(fakeRoon(queue), deps({ B: { found: true, synced: false, text: 'plain', source: 'embedded' } }))
      .prefetchZone('z');
    assert.deepEqual(looked, ['B']);
    assert.deepEqual(sleeps, []);
    assert.equal(prefetch.statusOf(track(2, 'A')), 'synced');
    assert.equal(prefetch.statusOf(track(3, 'B')), 'plain'); // local file: peek can't see it
  });

  test('stops at the first lyrics server error', async () => {
    const queue = [track(1, 'Now'), track(2, 'A'), track(3, 'B'), track(4, 'C')];
    await prefetch.createPrefetcher(fakeRoon(queue), deps({ A: { found: false, error: 'LRCLIB HTTP 503' } }))
      .prefetchZone('z');
    assert.deepEqual(looked, ['A']);
    assert.equal(prefetch.statusOf(track(2, 'A')), 'unknown');
  });

  test('does nothing for a zone that is not playing', async () => {
    const queue = [track(1, 'Now'), track(2, 'A')];
    await prefetch.createPrefetcher(fakeRoon(queue, { ...NOW, state: 'paused' }), deps()).prefetchZone('z');
    assert.deepEqual(looked, []);
  });

  test('a newer cycle cancels the running one', async () => {
    const queue = [track(1, 'Now'), track(2, 'A'), track(3, 'B'), track(4, 'C')];
    const waiting = [];
    const prefetcher = prefetch.createPrefetcher(fakeRoon(queue), {
      ...deps(),
      sleep: () => new Promise(r => waiting.push(r)),
    });
    const tick = () => new Promise(r => setImmediate(r));
    const first = prefetcher.prefetchZone('z'); // looks up A, then pauses before B
    await tick();
    assert.deepEqual(looked, ['A']);
    const second = prefetcher.prefetchZone('z'); // A is known: looks up B, pauses before C
    await tick();
    assert.deepEqual(looked, ['A', 'B']);
    waiting.splice(0).forEach(r => r()); // both pauses end
    await Promise.all([first, second]);
    // Only the newer cycle went on to C; the first one gave up after its pause.
    assert.deepEqual(looked, ['A', 'B', 'C']);
  });

  test('upcoming falls back to "first item is current" when the playing track is not listed', () => {
    const queue = [track(1, 'X'), track(2, 'A'), track(3, 'B')];
    assert.deepEqual(prefetch.upcoming(queue, NOW).map(t => t.title), ['A', 'B']);
  });
});

describe('lyricsResolver.peek', () => {
  test('reads the cache and the memo, never the network', async () => {
    const lrclibClient = require('../../src/lyrics/lrclibClient');
    lrclibClient.getTrack = async () => null;
    lrclibClient.search = async () => [];
    const t = { title: 'Gone', artist: 'Band', album: 'Record', duration_seconds: 100 };
    assert.equal(resolver.peek(t), 'unknown');
    await resolver.resolve(t); // a miss, remembered
    assert.equal(resolver.peek(t), 'none');
    lrcCache.setByMeta('Band', 'Gone', 'Record', 'plain words');
    assert.equal(resolver.peek(t), 'plain');
    assert.equal(resolver.peek({ title: 'x' }), 'unknown');
  });
});
