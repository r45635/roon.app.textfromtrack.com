'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { canEmbed, SUPPORTED_EXTENSIONS } = require('../../src/music/lyricsEmbedder');

describe('canEmbed', () => {
  test('returns true for .mp3', () => {
    assert.equal(canEmbed('/music/Song.mp3'), true);
  });
  test('returns true for .flac', () => {
    assert.equal(canEmbed('/music/Song.flac'), true);
  });
  test('returns true for uppercase .MP3', () => {
    assert.equal(canEmbed('/music/Song.MP3'), true);
  });
  test('returns false for .wav', () => {
    assert.equal(canEmbed('/music/Song.wav'), false);
  });
  test('returns false for unknown extensions', () => {
    assert.equal(canEmbed('/music/Song.ogg'), false);
    assert.equal(canEmbed('/music/Song'), false);
  });
});

describe('SUPPORTED_EXTENSIONS', () => {
  test('exposes a Set with mp3 and flac', () => {
    assert.ok(SUPPORTED_EXTENSIONS instanceof Set);
    assert.ok(SUPPORTED_EXTENSIONS.has('.mp3'));
    assert.ok(SUPPORTED_EXTENSIONS.has('.flac'));
    assert.ok(!SUPPORTED_EXTENSIONS.has('.wav'));
  });
});

describe('embedLyrics validation', () => {
  // We don't run actual embed in tests since it would need real audio files.
  // The validation paths are tested here.
  const { embedLyrics } = require('../../src/music/lyricsEmbedder');

  test('throws when file does not exist', () => {
    assert.throws(
      () => embedLyrics('/no/such/file.mp3', '[00:01.00]hello'),
      err => err.code === 'SOURCE_FILE_NOT_FOUND'
    );
  });

  test('throws when LRC content is empty', () => {
    // Use any path; the empty-content check fires before fs check
    assert.throws(
      () => embedLyrics('/no/such/file.mp3', ''),
      err => err.code === 'LYRICS_EMBED_FAILED'
    );
  });

  test('throws LYRICS_EMBED_UNSUPPORTED for .wav', () => {
    // Need an existing file for this path; create a temp empty wav-named file
    const fs = require('node:fs');
    const os = require('node:os');
    const tmp = path.join(os.tmpdir(), `tft-embed-test-${Date.now()}.wav`);
    fs.writeFileSync(tmp, 'fake');
    try {
      assert.throws(
        () => embedLyrics(tmp, '[00:01.00]hello'),
        err => err.code === 'LYRICS_EMBED_UNSUPPORTED'
      );
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
