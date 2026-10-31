'use strict';

// Docker users mount their data folder over src/storage: any code in there disappears and the
// container crashes at startup with MODULE_NOT_FOUND (GitHub issue #5).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('src/storage holds no code', () => {
  const dir = path.join(SRC, 'storage');
  const code = fs.existsSync(dir) ? jsFiles(dir) : [];
  assert.deepEqual(code, []);
});

test('no module is loaded from src/storage', () => {
  const offenders = jsFiles(SRC).filter((file) =>
    /require\(\s*['"][^'"]*\/storage\//.test(fs.readFileSync(file, 'utf8'))
  );
  assert.deepEqual(offenders, []);
});
