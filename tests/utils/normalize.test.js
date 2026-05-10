'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { E, buildError, AppError, normalizeStr, mapTftError } = require('../../src/utils/normalize');

// ─── E constants ─────────────────────────────────────────────────────────────

describe('E constants', () => {
  test('are non-empty strings', () => {
    for (const key of Object.keys(E)) {
      assert.equal(typeof E[key], 'string');
      assert.ok(E[key].length > 0);
    }
  });

  test('each value matches its key', () => {
    for (const [key, val] of Object.entries(E)) {
      assert.equal(key, val, `E.${key} value should equal the key`);
    }
  });
});

// ─── buildError ───────────────────────────────────────────────────────────────

describe('buildError', () => {
  test('returns success:false with an error envelope', () => {
    const result = buildError(E.ROON_NOT_CONNECTED, 'Not connected', { foo: 'bar' });
    assert.equal(result.success, false);
    assert.equal(result.error.code, E.ROON_NOT_CONNECTED);
    assert.equal(result.error.message, 'Not connected');
    assert.deepEqual(result.error.details, { foo: 'bar' });
  });

  test('defaults details to empty object', () => {
    const result = buildError(E.UNKNOWN_ERROR, 'Oops');
    assert.deepEqual(result.error.details, {});
  });

  test('has exactly the expected top-level keys', () => {
    const result = buildError(E.NO_CURRENT_TRACK, 'msg');
    assert.deepEqual(Object.keys(result).sort(), ['error', 'success']);
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'details', 'message']);
  });
});

// ─── AppError ─────────────────────────────────────────────────────────────────

describe('AppError', () => {
  test('is an instance of Error', () => {
    const e = new AppError(E.TFT_TOKEN_MISSING, 'Token missing');
    assert.ok(e instanceof Error);
  });

  test('carries code and message', () => {
    const e = new AppError(E.TFT_INSUFFICIENT_CREDITS, 'Not enough credits', { balance: 0 });
    assert.equal(e.code, E.TFT_INSUFFICIENT_CREDITS);
    assert.equal(e.message, 'Not enough credits');
    assert.deepEqual(e.details, { balance: 0 });
  });

  test('name is AppError', () => {
    const e = new AppError(E.UNKNOWN_ERROR, 'x');
    assert.equal(e.name, 'AppError');
  });
});

// ─── normalizeStr ─────────────────────────────────────────────────────────────

describe('normalizeStr', () => {
  test('returns empty string for null/undefined/empty', () => {
    assert.equal(normalizeStr(null), '');
    assert.equal(normalizeStr(undefined), '');
    assert.equal(normalizeStr(''), '');
  });

  test('lowercases input', () => {
    assert.equal(normalizeStr('HELLO'), 'hello');
    assert.equal(normalizeStr('Hello World'), 'hello world');
  });

  test('strips combining diacritics (NFD accent folding)', () => {
    assert.equal(normalizeStr('Héros'), 'heros');
    assert.equal(normalizeStr('Ünited'), 'united');
    assert.equal(normalizeStr('Björk'), 'bjork');
    assert.equal(normalizeStr('naïve'), 'naive');
  });

  test('replaces non-alphanumeric chars with spaces', () => {
    assert.equal(normalizeStr('hello, world!'), 'hello world');
    assert.equal(normalizeStr("rock 'n' roll"), 'rock n roll');
  });

  test('collapses multiple spaces', () => {
    assert.equal(normalizeStr('  too   many   spaces  '), 'too many spaces');
  });

  test('trims leading/trailing whitespace', () => {
    assert.equal(normalizeStr('  trim me  '), 'trim me');
  });

  test('preserves digits', () => {
    assert.equal(normalizeStr('Track 01'), 'track 01');
    assert.equal(normalizeStr('2001: A Space Odyssey'), '2001 a space odyssey');
  });

  test('parentheses/punctuation stripped to same form', () => {
    // Both reduce to the same token sequence after punctuation removal
    assert.equal(normalizeStr('(Bohemian Rhapsody)'), normalizeStr('Bohemian Rhapsody'));
    assert.equal(normalizeStr('AC/DC'), normalizeStr('AC DC'));
  });
});

// ─── mapTftError ──────────────────────────────────────────────────────────────

describe('mapTftError', () => {
  test('maps known TFT codes to local codes', () => {
    assert.equal(mapTftError('unauthorized'), E.TFT_UNAUTHORIZED);
    assert.equal(mapTftError('insufficient_credits'), E.TFT_INSUFFICIENT_CREDITS);
    assert.equal(mapTftError('track_too_long'), E.TFT_TRACK_TOO_LONG);
    assert.equal(mapTftError('unsupported_format'), E.TFT_UNSUPPORTED_FORMAT);
    assert.equal(mapTftError('not_found'), E.TFT_NOT_FOUND);
    assert.equal(mapTftError('gone'), E.TFT_EXPORT_EXPIRED);
    assert.equal(mapTftError('rate_limited'), E.TFT_RATE_LIMITED);
    assert.equal(mapTftError('internal_error'), E.TFT_INTERNAL_ERROR);
  });

  test('falls back to UNKNOWN_ERROR for unmapped code', () => {
    assert.equal(mapTftError('something_random'), E.UNKNOWN_ERROR);
    assert.equal(mapTftError(''), E.UNKNOWN_ERROR);
  });
});
