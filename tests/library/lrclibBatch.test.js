'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Storage and music root in a temp dir — set before any src module reads them.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-batch-test-'));
process.env.TFT_USER_DATA_DIR = tmpDir;
const musicDir = path.join(tmpDir, 'music');
fs.mkdirSync(musicDir, { recursive: true });

const { test, describe, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../src/config');
config.musicRoots = [musicDir];
const { writeJson, readJson } = require('../../src/utils/fileUtils');
const lyricsResolver = require('../../src/lyrics/lyricsResolver');
const batch = require('../../src/library/lrclibBatch');

batch.timing.pauseMs = 0;
batch.timing.retryWaitsMs = [20, 20];

const SYNCED = '[00:01.00]one\n[00:02.00]two';
let lookups;
let answers; // title -> result | Error

lyricsResolver.lookupLrclib = async (track) => {
  lookups.push(track.title);
  const a = answers[track.title];
  if (Array.isArray(a)) {
    const next = a.shift();
    if (next instanceof Error) throw next;
    return next;
  }
  if (a instanceof Error) throw a;
  return a || { found: false };
};

function addTracks(titles) {
  const tracks = titles.map((title, i) => {
    const p = path.join(musicDir, `${i} ${title}.wav`);
    fs.writeFileSync(p, '');
    return { path: p, title, artist: 'Artist', album: 'Album', duration_seconds: 100, lyrics_status: 'NO_LOCAL_LYRICS' };
  });
  writeJson(config.musicIndexPath, { version: 1, last_scan_at: null, track_count: tracks.length, music_roots: [musicDir], tracks });
  return tracks;
}

async function waitDone() {
  for (let i = 0; i < 200 && batch.getState().running; i++) await new Promise(r => setTimeout(r, 10));
  return batch.getState();
}

beforeEach(() => {
  lookups = [];
  answers = {};
  fs.rmSync(musicDir, { recursive: true, force: true });
  fs.mkdirSync(musicDir, { recursive: true });
  fs.rmSync(config.lrcCacheDir, { recursive: true, force: true });
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('lrclibBatch', () => {
  test('writes synced lyrics next to the file and updates the index', async () => {
    const [t] = addTracks(['Song A']);
    answers['Song A'] = { found: true, text: SYNCED, synced: true };
    batch.start([t.path]);
    const s = await waitDone();
    assert.equal(s.saved, 1);
    assert.equal(fs.readFileSync(t.path.replace(/\.wav$/, '.lrc'), 'utf8'), SYNCED);
    assert.equal(readJson(config.musicIndexPath).tracks[0].lyrics_status, 'HAS_LRC_FILE');
  });

  test('skips plain lyrics when synced_only, and counts misses', async () => {
    const tracks = addTracks(['Plain', 'Missing']);
    answers.Plain = { found: true, text: 'one\ntwo', synced: false };
    batch.start(tracks.map(t => t.path));
    const s = await waitDone();
    assert.equal(s.plain_skipped, 1);
    assert.equal(s.not_found, 1);
    assert.equal(s.saved, 0);
    assert.equal(fs.existsSync(tracks[0].path.replace(/\.wav$/, '.lrc')), false);
  });

  test('never overwrites lyrics already next to the file', async () => {
    const [t] = addTracks(['Has LRC']);
    fs.writeFileSync(t.path.replace(/\.wav$/, '.lrc'), 'mine');
    batch.start([t.path]);
    const s = await waitDone();
    assert.equal(s.already_had, 1);
    assert.deepEqual(lookups, []);
    assert.equal(fs.readFileSync(t.path.replace(/\.wav$/, '.lrc'), 'utf8'), 'mine');
  });

  test('waits and retries when LRCLIB is busy', async () => {
    const [t] = addTracks(['Busy']);
    answers.Busy = [new Error('LRCLIB HTTP 503: busy'), { found: true, text: SYNCED, synced: true }];
    batch.start([t.path]);
    const s = await waitDone();
    assert.equal(s.saved, 1);
    assert.deepEqual(lookups, ['Busy', 'Busy']);
  });

  test('gives up on a track after the retries and reports the error', async () => {
    const [t] = addTracks(['Down']);
    answers.Down = new Error('LRCLIB HTTP 503: busy');
    batch.start([t.path]);
    const s = await waitDone();
    assert.equal(s.failed, 1);
    assert.equal(lookups.length, 3);
    assert.match(s.errors[0].error, /503/);
  });

  test('refuses a second batch while one runs, and can be cancelled', async () => {
    const tracks = addTracks(['A', 'B', 'C', 'D']);
    answers.A = new Error('LRCLIB HTTP 503: busy'); // keeps the batch waiting
    batch.start(tracks.map(t => t.path));
    assert.throws(() => batch.start([tracks[0].path]), { code: 'BATCH_RUNNING' });
    batch.cancel();
    const s = await waitDone();
    assert.equal(s.cancelled, true);
    assert.ok(s.done < 4);
  });

  test('rejects an empty selection', () => {
    addTracks([]);
    assert.throws(() => batch.start(['/not/in/index.wav']), { code: 'NOTHING_TO_DO' });
  });
});
