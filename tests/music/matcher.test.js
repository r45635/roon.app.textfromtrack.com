'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { scoreTrack, scoreToConfidence, match } = require('../../src/music/matcher');

// ─── Helper fixtures ──────────────────────────────────────────────────────────

function roon(overrides = {}) {
  return {
    title: 'Money',
    artist: 'Pink Floyd',
    album: 'The Dark Side of the Moon',
    duration_seconds: 382,
    ...overrides,
  };
}

function track(overrides = {}) {
  return {
    path: '/music/Pink Floyd/DSOTM/track.flac',
    filename: 'track.flac',
    title: 'Money',
    artist: 'Pink Floyd',
    album: 'The Dark Side of the Moon',
    duration_seconds: 382,
    lyrics_status: 'NO_LOCAL_LYRICS',
    ...overrides,
  };
}

// ─── scoreTrack ───────────────────────────────────────────────────────────────

describe('scoreTrack', () => {
  test('perfect match scores 50+30+20+20 = 120', () => {
    // filename 'track.flac' does not contain the title 'money'
    assert.equal(scoreTrack(roon(), track()), 120);
  });

  test('title match alone gives 50', () => {
    const score = scoreTrack(
      roon({ artist: '', album: '', duration_seconds: null }),
      track({ artist: '', album: '', duration_seconds: null })
    );
    assert.equal(score, 50);
  });

  test('artist match alone gives 30', () => {
    const score = scoreTrack(
      roon({ title: '', album: '', duration_seconds: null }),
      track({ title: '', album: '', duration_seconds: null })
    );
    assert.equal(score, 30);
  });

  test('album match alone gives 20', () => {
    const score = scoreTrack(
      roon({ title: '', artist: '', duration_seconds: null }),
      track({ title: '', artist: '', duration_seconds: null })
    );
    assert.equal(score, 20);
  });

  test('duration delta < 2 s adds 20', () => {
    const score = scoreTrack(
      roon({ title: '', artist: '', album: '', duration_seconds: 100 }),
      track({ title: '', artist: '', album: '', duration_seconds: 101 })
    );
    assert.equal(score, 20);
  });

  test('duration delta 2-5 s adds 10', () => {
    const score = scoreTrack(
      roon({ title: '', artist: '', album: '', duration_seconds: 100 }),
      track({ title: '', artist: '', album: '', duration_seconds: 104 })
    );
    assert.equal(score, 10);
  });

  test('duration delta >= 5 s adds nothing', () => {
    const score = scoreTrack(
      roon({ title: '', artist: '', album: '', duration_seconds: 100 }),
      track({ title: '', artist: '', album: '', duration_seconds: 110 })
    );
    assert.equal(score, 0);
  });

  test('filename containing title adds 10', () => {
    const score = scoreTrack(
      roon({ artist: '', album: '', duration_seconds: null }),
      track({ title: '', artist: '', album: '', duration_seconds: null, filename: '06 Money.flac' })
    );
    // normalizeStr('06 Money.flac') = '06 money flac' which includes 'money'
    assert.equal(score, 10);
  });

  test('no match gives 0', () => {
    const score = scoreTrack(
      roon({ title: 'Comfortably Numb', artist: 'Pink Floyd', album: 'The Wall', duration_seconds: 382 }),
      track({ title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', duration_seconds: 354 })
    );
    assert.equal(score, 0);
  });

  test('accent-insensitive match: Björk vs Bjork scores full artist match', () => {
    const score = scoreTrack(
      roon({ title: 'Jóga', artist: 'Björk', album: '', duration_seconds: null }),
      track({ title: 'Joga', artist: 'Bjork', album: '', duration_seconds: null })
    );
    // title match 50 + artist match 30 = 80
    assert.equal(score, 80);
  });
});

// ─── scoreToConfidence ────────────────────────────────────────────────────────

describe('scoreToConfidence', () => {
  test('score >= 90 → high', () => {
    assert.equal(scoreToConfidence(90), 'high');
    assert.equal(scoreToConfidence(120), 'high');
    assert.equal(scoreToConfidence(100), 'high');
  });

  test('score 60-89 → medium', () => {
    assert.equal(scoreToConfidence(60), 'medium');
    assert.equal(scoreToConfidence(80), 'medium');
    assert.equal(scoreToConfidence(89), 'medium');
  });

  test('score 35-59 → low', () => {
    assert.equal(scoreToConfidence(35), 'low');
    assert.equal(scoreToConfidence(50), 'low');
    assert.equal(scoreToConfidence(59), 'low');
  });

  test('score < 35 → none', () => {
    assert.equal(scoreToConfidence(0), 'none');
    assert.equal(scoreToConfidence(34), 'none');
  });
});

// ─── match ────────────────────────────────────────────────────────────────────

describe('match', () => {
  test('returns no match for empty index', () => {
    const result = match(roon(), []);
    assert.equal(result.matched, false);
    assert.equal(result.confidence, 'none');
    assert.equal(result.track, null);
  });

  test('returns no match when null index', () => {
    const result = match(roon(), null);
    assert.equal(result.matched, false);
  });

  test('finds best matching track', () => {
    const tracks = [
      track({ title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera' }),
      track(), // perfect match
      track({ title: 'Money (Remix)', artist: 'Pink Floyd', album: 'The Dark Side of the Moon' }),
    ];
    const result = match(roon(), tracks);
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 'high');
    assert.equal(result.track.title, 'Money');
    assert.equal(result.score, 120); // filename 'track.flac' adds no bonus
  });

  test('returns alternatives (up to 5, excluding best)', () => {
    const tracks = [
      track(),
      track({ title: 'Money', artist: 'Pink Floyd', album: '', duration_seconds: 380 }),
      track({ title: 'Money', artist: 'Pink Floyd', album: '', duration_seconds: 400 }),
    ];
    const result = match(roon(), tracks);
    assert.equal(result.matched, true);
    assert.ok(result.alternatives.length >= 1);
    assert.ok(result.alternatives.length <= 5);
  });

  test('filters out candidates below LOW threshold', () => {
    const tracks = [
      track({ title: 'Completely Different', artist: 'Other Artist', album: 'Other Album', duration_seconds: 999 }),
    ];
    const result = match(roon(), tracks);
    assert.equal(result.matched, false);
    assert.equal(result.track, null);
  });

  test('matched:false when best confidence is none', () => {
    // Low-scoring track — score = 30 (artist 30, but title/album mismatch, no duration)
    const tracks = [
      track({ title: 'Other Title', album: 'Other Album', duration_seconds: 999 }),
    ];
    const result = match(roon(), tracks);
    // score should be 30 (artist only) which is below LOW=35 threshold
    assert.equal(result.matched, false);
  });

  test('alternatives contain expected shape', () => {
    const tracks = [
      track(),
      track({ path: '/other.flac', title: 'Money', artist: 'Pink Floyd', album: '', duration_seconds: 380 }),
    ];
    const result = match(roon(), tracks);
    for (const alt of result.alternatives) {
      assert.ok('path' in alt);
      assert.ok('title' in alt);
      assert.ok('artist' in alt);
      assert.ok('confidence' in alt);
      assert.ok('lyrics_status' in alt);
    }
  });
});
