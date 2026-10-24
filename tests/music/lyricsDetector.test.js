'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getLrcPath, hasLrcFile, hasEmbeddedLyrics, detectFromMetadata, extractEmbeddedLyrics, STATUS } = require('../../src/music/lyricsDetector');

// ─── Temporary directory ──────────────────────────────────────────────────────

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-lyrics-test-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function audioFile(name) {
  return path.join(tmpDir, name);
}

// ─── STATUS constants ─────────────────────────────────────────────────────────

describe('STATUS constants', () => {
  test('exports the 4 expected constants', () => {
    assert.equal(STATUS.HAS_LRC_FILE, 'HAS_LRC_FILE');
    assert.equal(STATUS.HAS_EMBEDDED_LYRICS, 'HAS_EMBEDDED_LYRICS');
    assert.equal(STATUS.NO_LOCAL_LYRICS, 'NO_LOCAL_LYRICS');
    assert.equal(STATUS.UNKNOWN, 'UNKNOWN');
  });
});

// ─── getLrcPath ───────────────────────────────────────────────────────────────

describe('getLrcPath', () => {
  test('replaces .mp3 with .lrc', () => {
    assert.equal(getLrcPath('/music/Track.mp3'), '/music/Track.lrc');
  });

  test('replaces .flac with .lrc', () => {
    assert.equal(getLrcPath('/music/Track.flac'), '/music/Track.lrc');
  });

  test('replaces .wav with .lrc', () => {
    assert.equal(getLrcPath('/some/path/song.wav'), '/some/path/song.lrc');
  });

  test('replaces .m4a with .lrc', () => {
    assert.equal(getLrcPath('/song.m4a'), '/song.lrc');
  });

  test('handles paths with dots in directory names', () => {
    assert.equal(getLrcPath('/my.music/collection/Track.mp3'), '/my.music/collection/Track.lrc');
  });
});

// ─── hasLrcFile ───────────────────────────────────────────────────────────────

describe('hasLrcFile', () => {
  test('returns true when .lrc sidecar exists', () => {
    const audio = audioFile('with-lrc.mp3');
    const lrc = audioFile('with-lrc.lrc');
    fs.writeFileSync(audio, '', 'utf8');
    fs.writeFileSync(lrc, '[00:00.00] Test', 'utf8');
    assert.equal(hasLrcFile(audio), true);
  });

  test('returns false when .lrc sidecar does not exist', () => {
    const audio = audioFile('no-lrc.mp3');
    fs.writeFileSync(audio, '', 'utf8');
    assert.equal(hasLrcFile(audio), false);
  });

  test('returns false for a non-existent audio file', () => {
    assert.equal(hasLrcFile(audioFile('ghost.mp3')), false);
  });
});

// ─── hasEmbeddedLyrics ────────────────────────────────────────────────────────

describe('hasEmbeddedLyrics', () => {
  test('returns false for null/undefined common', () => {
    assert.equal(hasEmbeddedLyrics(null), false);
    assert.equal(hasEmbeddedLyrics(undefined), false);
  });

  test('returns false when common.lyrics is absent', () => {
    assert.equal(hasEmbeddedLyrics({}), false);
  });

  test('returns false when lyrics is an empty array', () => {
    assert.equal(hasEmbeddedLyrics({ lyrics: [] }), false);
  });

  test('returns true for a string lyrics entry', () => {
    assert.equal(hasEmbeddedLyrics({ lyrics: ['Some lyrics here'] }), true);
  });

  test('returns false for empty string entry', () => {
    assert.equal(hasEmbeddedLyrics({ lyrics: [''] }), false);
  });

  test('returns true for object lyrics with .text property', () => {
    assert.equal(hasEmbeddedLyrics({ lyrics: [{ text: 'La la la' }] }), true);
  });

  test('returns false for object lyrics with empty .text', () => {
    assert.equal(hasEmbeddedLyrics({ lyrics: [{ text: '' }] }), false);
  });

  test('returns true when at least one entry is non-empty (mixed array)', () => {
    assert.equal(hasEmbeddedLyrics({ lyrics: ['', 'Some text'] }), true);
  });
});

// ─── detectFromMetadata ───────────────────────────────────────────────────────

describe('detectFromMetadata', () => {
  test('returns HAS_LRC_FILE when .lrc sidecar exists (takes priority)', () => {
    const audio = audioFile('priority-test.mp3');
    const lrc = audioFile('priority-test.lrc');
    fs.writeFileSync(audio, '', 'utf8');
    fs.writeFileSync(lrc, '[00:00.00] Test', 'utf8');
    const common = { lyrics: ['embedded lyrics here'] };
    // LRC should take priority over embedded
    assert.equal(detectFromMetadata(audio, common), STATUS.HAS_LRC_FILE);
  });

  test('returns HAS_EMBEDDED_LYRICS when embedded lyrics present but no .lrc', () => {
    const audio = audioFile('embedded-only.mp3');
    fs.writeFileSync(audio, '', 'utf8');
    const common = { lyrics: ['Verse 1...'] };
    assert.equal(detectFromMetadata(audio, common), STATUS.HAS_EMBEDDED_LYRICS);
  });

  test('returns NO_LOCAL_LYRICS when neither .lrc nor embedded exists', () => {
    const audio = audioFile('no-lyrics-at-all.mp3');
    fs.writeFileSync(audio, '', 'utf8');
    assert.equal(detectFromMetadata(audio, {}), STATUS.NO_LOCAL_LYRICS);
  });

  test('returns NO_LOCAL_LYRICS when common is null', () => {
    const audio = audioFile('null-common.mp3');
    fs.writeFileSync(audio, '', 'utf8');
    assert.equal(detectFromMetadata(audio, null), STATUS.NO_LOCAL_LYRICS);
  });
});

// ─── extractEmbeddedLyrics ────────────────────────────────────────────────────

describe('extractEmbeddedLyrics', () => {
  const syncText = [
    { timestamp: 500, text: 'Première ligne' },
    { timestamp: 61750, text: 'Second line' },
  ];
  const LRC = '[00:00.50]Première ligne\n[01:01.75]Second line';

  test('rebuilds LRC from syncText (music-metadata 10 FLAC shape)', () => {
    const metadata = { common: { lyrics: [{ contentType: 1, timeStampFormat: 2, syncText }] } };
    assert.equal(extractEmbeddedLyrics(metadata), LRC);
  });

  test('keeps timestamps when text is also filled (music-metadata ≥ 11 FLAC shape)', () => {
    const metadata = { common: { lyrics: [{ text: 'Première ligne\nSecond line', syncText }] } };
    assert.equal(extractEmbeddedLyrics(metadata), LRC);
  });

  test('returns USLT text (MP3 object shape)', () => {
    const metadata = { common: { lyrics: [{ language: 'eng', descriptor: 'LYRICS', text: '[00:00.50]Hello' }] } };
    assert.equal(extractEmbeddedLyrics(metadata), '[00:00.50]Hello');
  });

  test('accepts plain strings', () => {
    assert.equal(extractEmbeddedLyrics({ common: { lyrics: ['Verse 1'] } }), 'Verse 1');
  });

  test('falls back to the native Vorbis LYRICS comment', () => {
    const metadata = {
      common: { lyrics: [{ syncText: [] }] },
      native: { vorbis: [{ id: 'TITLE', value: 'x' }, { id: 'lyrics', value: '[00:01.00]Raw' }] },
    };
    assert.equal(extractEmbeddedLyrics(metadata), '[00:01.00]Raw');
  });

  test('returns null when there are no lyrics', () => {
    assert.equal(extractEmbeddedLyrics({ common: {} }), null);
    assert.equal(extractEmbeddedLyrics(null), null);
  });
});
