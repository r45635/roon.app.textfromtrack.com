'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { accessGuard } = require('../../src/utils/accessGuard');

const TOKEN = 's3cret-token';

function run(guard, { path = '/api/roon/status', method = 'GET', ip = '192.168.2.10', headers = {}, query = {}, originalUrl } = {}) {
  const req = { path, method, headers, query, originalUrl: originalUrl || path, socket: { remoteAddress: ip } };
  const res = {
    statusCode: 200, headers: {}, body: null, location: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    type() { return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    redirect(c, l) { this.statusCode = c; this.location = l; },
  };
  let nextCalled = false;
  guard(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

describe('accessGuard', () => {
  const guard = accessGuard(TOKEN);

  test('disabled without a token', () => {
    assert.equal(run(accessGuard('')).nextCalled, true);
  });

  test('rejects LAN API calls without the token', () => {
    const { res, nextCalled } = run(guard);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, 'ACCESS_TOKEN_REQUIRED');
  });

  test('serves the login page for page loads', () => {
    const { res } = run(guard, { path: '/' });
    assert.equal(res.statusCode, 401);
    assert.match(res.body, /access_token/);
  });

  test('accepts a bearer token or the cookie, not a wrong one', () => {
    assert.equal(run(guard, { headers: { authorization: `Bearer ${TOKEN}` } }).nextCalled, true);
    assert.equal(run(guard, { headers: { cookie: `a=b; tft_access=${encodeURIComponent(TOKEN)}` } }).nextCalled, true);
    assert.equal(run(guard, { headers: { authorization: 'Bearer nope' } }).nextCalled, false);
  });

  test('?access_token= sets the cookie and redirects without it', () => {
    const { res, nextCalled } = run(guard, { path: '/', query: { access_token: TOKEN }, originalUrl: `/?access_token=${TOKEN}&x=1` });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 302);
    assert.equal(res.location, '/?x=1');
    assert.match(res.headers['set-cookie'], /tft_access=s3cret-token;.*HttpOnly/);
  });

  test('loopback is exempt unless proxied; the webhook is exempt', () => {
    assert.equal(run(guard, { ip: '127.0.0.1' }).nextCalled, true);
    assert.equal(run(guard, { ip: '::1' }).nextCalled, true);
    assert.equal(run(guard, { ip: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.5' } }).nextCalled, false);
    assert.equal(run(guard, { path: '/api/tft/webhook', method: 'POST' }).nextCalled, true);
  });
});
