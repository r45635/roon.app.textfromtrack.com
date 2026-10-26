'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Storage and music root in a temp dir — set before any src module reads them.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-scan-test-'));
process.env.TFT_USER_DATA_DIR = tmpDir;
const musicDir = path.join(tmpDir, 'music');

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../src/config');
const scanner = require('../../src/music/scanner');

/** A valid one-second 8 kHz mono 16-bit WAV, so music-metadata can parse it. */
function writeWav(file) {
  const samples = 8000;
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
}

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('scan', () => {
  test('walks nested folders, skips AppleDouble files, sees .lrc sidecars, reports missing roots', async () => {
    const withLrc = path.join(musicDir, 'Artist', 'Album', '01 Song.wav');
    const without = path.join(musicDir, 'Artist', 'Other', '02 Song.wav');
    writeWav(withLrc);
    writeWav(without);
    fs.writeFileSync(path.join(musicDir, 'Artist', 'Album', '01 Song.lrc'), '[00:00.50]hello');
    fs.writeFileSync(path.join(musicDir, 'Artist', 'Album', '._01 Song.wav'), 'resource fork');
    fs.writeFileSync(path.join(musicDir, 'Artist', 'Album', 'cover.jpg'), 'not audio');
    const missing = path.join(tmpDir, 'unplugged-drive');
    config.musicRoots = [musicDir, missing];

    const result = await scanner.scan();

    assert.equal(result.track_count, 2);
    assert.deepEqual(result.missing_roots, [missing]);
    const byPath = Object.fromEntries(scanner.loadIndex().tracks.map(t => [t.path, t]));
    assert.deepEqual(Object.keys(byPath).sort(), [withLrc, without].sort());
    assert.equal(byPath[withLrc].lyrics_status, 'HAS_LRC_FILE');
    assert.equal(byPath[without].lyrics_status, 'NO_LOCAL_LYRICS');
    assert.equal(byPath[without].duration_seconds, 1);
  });

  test('keeps the previous index when no music folder is reachable', async () => {
    config.musicRoots = [path.join(tmpDir, 'nowhere')];
    await assert.rejects(scanner.scan(), /No music folder is reachable/);
    assert.equal(scanner.loadIndex().track_count, 2);
  });
});
