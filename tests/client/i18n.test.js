'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ─── Translation files: same keys in every language, every used key defined ──

const clientSrc = path.join(__dirname, '..', '..', 'client', 'src');
const en = JSON.parse(fs.readFileSync(path.join(clientSrc, 'i18n', 'en.json'), 'utf8'));
const fr = JSON.parse(fs.readFileSync(path.join(clientSrc, 'i18n', 'fr.json'), 'utf8'));

function flatten(obj, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') out.push(...flatten(value, full));
    else out.push(full);
  }
  return out;
}

// i18next plural keys (credits_one / credits_other) are looked up as "credits".
const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/;

function definedKeys(dict) {
  const keys = new Set(flatten(dict));
  for (const k of [...keys]) if (PLURAL_SUFFIX_RE.test(k)) keys.add(k.replace(PLURAL_SUFFIX_RE, ''));
  return keys;
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter(f => /\.(jsx?|tsx?)$/.test(f))
    .map(f => path.join(dir, f));
}

/** Static keys passed to t('…') — template keys like t(`a.${x}`) are skipped. */
function usedKeys() {
  const used = new Map();
  for (const file of sourceFiles(clientSrc)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, key] of text.matchAll(/\bt\(\s*'([a-z_][\w.]*)'/g)) {
      if (!used.has(key)) used.set(key, path.relative(clientSrc, file));
    }
  }
  return used;
}

describe('client i18n', () => {
  test('en.json and fr.json define the same keys', () => {
    const enKeys = new Set(flatten(en));
    const frKeys = new Set(flatten(fr));
    assert.deepEqual([...enKeys].filter(k => !frKeys.has(k)), [], 'keys missing from fr.json');
    assert.deepEqual([...frKeys].filter(k => !enKeys.has(k)), [], 'keys missing from en.json');
  });

  test('every t(\'…\') key used in client/src exists in en.json', () => {
    const defined = definedKeys(en);
    const missing = [...usedKeys()].filter(([key]) => !defined.has(key)).map(([key, file]) => `${key} (${file})`);
    assert.deepEqual(missing, []);
  });
});
