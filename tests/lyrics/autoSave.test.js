'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-autosave-test-'));
process.env.TFT_USER_DATA_DIR = tmpDir;

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const userSettings = require('../../src/settings/userSettings');
const jobStore = require('../../src/textfromtrack/jobStore');
const { autoSave } = require('../../src/lyrics/nowPlayingLyrics');

const SYNCED = '[00:01.00]one\n[00:02.00]two';
const NP = { title: 'Song', artist: 'Artist', album: 'Album' };

function wav(name) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, '');
  return p;
}

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('autoSave', () => {
  test('does nothing while the setting is off', () => {
    const p = wav('off.wav');
    assert.equal(autoSave(NP, { found: true, synced: true, text: SYNCED, source: 'lrclib' }, p), false);
    assert.equal(fs.existsSync(p.replace(/\.wav$/, '.lrc')), false);
  });

  test('writes synced LRCLIB lyrics and records the job when on', () => {
    userSettings.set({ auto_save_lrclib: true });
    const p = wav('on.wav');
    assert.equal(autoSave(NP, { found: true, synced: true, text: SYNCED, source: 'lrclib' }, p), true);
    assert.equal(fs.readFileSync(p.replace(/\.wav$/, '.lrc'), 'utf8'), SYNCED);
    const job = jobStore.list()[0];
    assert.equal(job.source_file, p);
    assert.equal(job.auto_saved, true);
  });

  test('never writes lyrics that came from the file, plain lyrics, or without a file', () => {
    userSettings.set({ auto_save_lrclib: true });
    const p = wav('skip.wav');
    assert.equal(autoSave(NP, { found: true, synced: true, text: SYNCED, source: 'embedded' }, p), false);
    assert.equal(autoSave(NP, { found: true, synced: false, text: 'one', source: 'lrclib' }, p), false);
    assert.equal(autoSave(NP, { found: true, synced: true, text: SYNCED, source: 'lrclib' }, null), false);
    assert.equal(fs.existsSync(p.replace(/\.wav$/, '.lrc')), false);
  });
});
