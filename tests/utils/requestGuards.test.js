'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedHost, parseAllowedHosts, originGuard } = require('../../src/utils/requestGuards');

function run(guard, { method = 'POST', origin, host = 'localhost:3888' } = {}) {
  const headers = { origin, host };
  const req = { method, get: (name) => headers[name.toLowerCase()] };
  let status = null;
  let passed = false;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  guard(req, res, () => { passed = true; });
  return { passed, status };
}

describe('isAllowedHost', () => {
  test('accepts localhost, IPs and LAN names', () => {
    for (const h of ['localhost', '127.0.0.1', '192.168.2.30', '[::1]', 'nas', 'mac-studio.local', 'nas.lan', 'box.home.arpa']) {
      assert.equal(isAllowedHost(h, []), true, h);
    }
  });

  test('rejects public domain names (DNS rebinding)', () => {
    for (const h of ['evil.example.com', 'attacker.net', '127.0.0.1.nip.io', '']) {
      assert.equal(isAllowedHost(h, []), false, h);
    }
  });

  test('ALLOWED_HOSTS adds names, * allows any', () => {
    assert.equal(isAllowedHost('lyrics.mydomain.com', parseAllowedHosts('lyrics.mydomain.com, other.org')), true);
    assert.equal(isAllowedHost('evil.example.com', parseAllowedHosts('*')), true);
  });
});

describe('originGuard', () => {
  test('lets safe methods through whatever the Origin', () => {
    assert.equal(run(originGuard, { method: 'GET', origin: 'https://evil.example.com' }).passed, true);
  });

  test('lets non-browser writes (no Origin) through', () => {
    assert.equal(run(originGuard, {}).passed, true);
  });

  test('lets same-origin writes through', () => {
    assert.equal(run(originGuard, { origin: 'http://localhost:3888' }).passed, true);
  });

  test('rejects cross-origin and malformed Origin writes', () => {
    assert.deepEqual(run(originGuard, { origin: 'https://evil.example.com' }), { passed: false, status: 403 });
    assert.deepEqual(run(originGuard, { origin: 'null' }), { passed: false, status: 403 });
  });
});
