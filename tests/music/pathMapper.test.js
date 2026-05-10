'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ─── Patch config before requiring pathMapper ─────────────────────────────────
// config is a CommonJS singleton — mutate it before pathMapper loads it.

const config = require('../../src/config');
config.pathMappings = [
  { from: 'smb://nas.local/Music', to: '/Volumes/Music' },
  { from: '/volume2/music', to: '/Volumes/Music' },
];

const { mapPath, normalizeRoonPath, resolve } = require('../../src/music/pathMapper');

// ─── mapPath ──────────────────────────────────────────────────────────────────

describe('mapPath', () => {
  test('maps matching SMB prefix to local path', () => {
    const result = mapPath('smb://nas.local/Music/Pink Floyd/Track.flac');
    assert.equal(result, '/Volumes/Music/Pink Floyd/Track.flac');
  });

  test('applies first matching rule (order matters)', () => {
    // Both rules could theoretically match a crafted path — first one wins
    const result = mapPath('smb://nas.local/Music/subdir/song.mp3');
    assert.equal(result, '/Volumes/Music/subdir/song.mp3');
  });

  test('maps second rule when first does not match', () => {
    const result = mapPath('/volume2/music/Artist/Album/Track.mp3');
    assert.equal(result, '/Volumes/Music/Artist/Album/Track.mp3');
  });

  test('returns path unchanged when no mapping matches', () => {
    const original = '/local/path/that/needs/no/mapping.flac';
    assert.equal(mapPath(original), original);
  });

  test('returns falsy input unchanged', () => {
    assert.equal(mapPath(null), null);
    assert.equal(mapPath(''), '');
    assert.equal(mapPath(undefined), undefined);
  });

  test('preserves sub-path correctly after prefix replacement', () => {
    const result = mapPath('smb://nas.local/Music');
    assert.equal(result, '/Volumes/Music');
  });
});

// ─── normalizeRoonPath ────────────────────────────────────────────────────────

describe('normalizeRoonPath', () => {
  test('returns absolute paths unchanged', () => {
    const p = '/local/music/track.flac';
    assert.equal(normalizeRoonPath(p), p);
  });

  test('returns SMB URLs as-is (for subsequent mapPath)', () => {
    const smb = 'smb://nas.local/Music/track.flac';
    assert.equal(normalizeRoonPath(smb), smb);
  });

  test('returns null/empty unchanged', () => {
    assert.equal(normalizeRoonPath(null), null);
    assert.equal(normalizeRoonPath(''), '');
  });
});

// ─── resolve ──────────────────────────────────────────────────────────────────

describe('resolve', () => {
  test('normalizes then maps: SMB URL → local path', () => {
    const result = resolve('smb://nas.local/Music/Artist/Track.flac');
    assert.equal(result, '/Volumes/Music/Artist/Track.flac');
  });

  test('returns local paths unchanged', () => {
    const p = '/already/local/path.flac';
    assert.equal(resolve(p), p);
  });

  test('handles null gracefully', () => {
    assert.equal(resolve(null), null);
  });
});
