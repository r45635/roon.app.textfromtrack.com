'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');

// Fake https.get: serve queued { status, body, headers } answers, record each call.
let answers = [];
let calls = 0;
https.get = (url, opts, cb) => {
  calls++;
  const a = answers.shift() || { status: 500, body: {} };
  const req = new EventEmitter();
  req.destroy = () => {};
  setImmediate(() => {
    const res = new EventEmitter();
    res.statusCode = a.status;
    res.headers = a.headers || {};
    cb(res);
    res.emit('data', Buffer.from(JSON.stringify(a.body)));
    res.emit('end');
  });
  return req;
};
const client = require('../../src/lyrics/lrclibClient');

beforeEach(() => { answers = []; calls = 0; });

describe('lrclibClient', () => {
  test('a single 503 is retried once and the second answer is used', async () => {
    answers = [
      { status: 503, body: { message: 'busy' }, headers: { 'retry-after': '0.3' } },
      { status: 200, body: { id: 1, syncedLyrics: '[00:01.00]x' } },
    ];
    const rec = await client.getTrack({ title: 't', artist: 'a' });
    assert.equal(rec.id, 1);
    assert.equal(calls, 2);
  });

  test('two 503 in a row raise an error (not "no lyrics")', async () => {
    answers = [
      { status: 503, body: { message: 'The server is busy' }, headers: { 'retry-after': '0.3' } },
      { status: 503, body: { message: 'The server is busy' } },
    ];
    await assert.rejects(() => client.search({ title: 't', artist: 'a' }), /LRCLIB HTTP 503: The server is busy/);
  });

  test('404 is "not found", without retry', async () => {
    answers = [{ status: 404, body: {} }];
    assert.equal(await client.getTrack({ title: 't', artist: 'a' }), null);
    assert.equal(calls, 1);
  });

  test('the User-Agent names the app version', () => {
    assert.match(client.USER_AGENT, /^TextFromTrackRoonCompanion\/\d+\.\d+\.\d+ /);
  });
});
