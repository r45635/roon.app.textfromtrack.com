'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJson, writeJson, ensureDir } = require('../../src/utils/fileUtils');

// ─── Temporary directory ──────────────────────────────────────────────────────

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-fileutils-test-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tmpFile(name) {
  return path.join(tmpDir, name);
}

// ─── readJson ─────────────────────────────────────────────────────────────────

describe('readJson', () => {
  test('reads and parses a valid JSON file', () => {
    const file = tmpFile('valid.json');
    fs.writeFileSync(file, JSON.stringify({ a: 1, b: [2, 3] }), 'utf8');
    const result = readJson(file, null);
    assert.deepEqual(result, { a: 1, b: [2, 3] });
  });

  test('returns defaultValue when file does not exist', () => {
    const result = readJson(tmpFile('does-not-exist.json'), 'MISSING');
    assert.equal(result, 'MISSING');
  });

  test('returns defaultValue for invalid JSON', () => {
    const file = tmpFile('broken.json');
    fs.writeFileSync(file, '{ broken json }', 'utf8');
    const result = readJson(file, []);
    assert.deepEqual(result, []);
  });

  test('returns null by default when file is missing', () => {
    const result = readJson(tmpFile('no-default.json'));
    assert.equal(result, null);
  });

  test('parses array JSON correctly', () => {
    const file = tmpFile('array.json');
    fs.writeFileSync(file, JSON.stringify([1, 2, 3]), 'utf8');
    assert.deepEqual(readJson(file, []), [1, 2, 3]);
  });
});

// ─── writeJson ────────────────────────────────────────────────────────────────

describe('writeJson', () => {
  test('writes data and can be read back', () => {
    const file = tmpFile('write-test.json');
    const payload = { name: 'test', values: [10, 20] };
    writeJson(file, payload);
    const raw = fs.readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(raw), payload);
  });

  test('overwrites an existing file', () => {
    const file = tmpFile('overwrite.json');
    writeJson(file, { v: 1 });
    writeJson(file, { v: 2 });
    assert.equal(readJson(file, null)?.v, 2);
  });

  test('does not leave a .tmp file behind on success', () => {
    const file = tmpFile('notmp.json');
    writeJson(file, { ok: true });
    assert.ok(!fs.existsSync(file + '.tmp'), '.tmp file should be cleaned up');
  });

  test('creates parent directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'sub', 'deep', 'file.json');
    writeJson(nested, { nested: true });
    assert.ok(fs.existsSync(nested));
  });

  test('output is pretty-printed JSON', () => {
    const file = tmpFile('pretty.json');
    writeJson(file, { x: 1 });
    const raw = fs.readFileSync(file, 'utf8');
    // Pretty-printed JSON contains newlines
    assert.ok(raw.includes('\n'));
  });
});

// ─── ensureDir ────────────────────────────────────────────────────────────────

describe('ensureDir', () => {
  test('creates a directory that does not exist', () => {
    const dir = path.join(tmpDir, 'new-dir');
    assert.ok(!fs.existsSync(dir));
    ensureDir(dir);
    assert.ok(fs.existsSync(dir));
    assert.ok(fs.statSync(dir).isDirectory());
  });

  test('does nothing if directory already exists', () => {
    const dir = path.join(tmpDir, 'existing-dir');
    fs.mkdirSync(dir);
    assert.doesNotThrow(() => ensureDir(dir));
  });

  test('creates nested directories', () => {
    const dir = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(dir);
    assert.ok(fs.statSync(dir).isDirectory());
  });
});
