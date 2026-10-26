'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const qrRoutes = require('../../src/api/qrRoutes');

let server;
let base;

before(async () => {
  const app = express();
  app.use('/api/qr', qrRoutes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/qr`;
});

after(() => server.close());

async function page(query = '', headers = {}) {
  const res = await fetch(`${base}${query}`, { headers });
  assert.equal(res.status, 200);
  return res.text();
}

describe('QR page language', () => {
  test('English by default', async () => {
    const html = await page('?privacy=1');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /Connect from your phone/);
  });

  test('French with ?lang=fr (the web UI passes its language)', async () => {
    const html = await page('?privacy=1&lang=fr');
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /Ouvrir sur votre téléphone/);
    assert.doesNotMatch(html, /Connect from your phone/);
  });

  test('falls back to the browser language when no lang is given', async () => {
    const html = await page('?privacy=1', { 'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.5' });
    assert.match(html, /Ouvrir sur votre téléphone/);
  });

  test('an unknown lang falls back to English', async () => {
    const html = await page('?privacy=1&lang=de', { 'Accept-Language': 'de' });
    assert.match(html, /Connect from your phone/);
  });

  test('screenshot mode shows the example address', async () => {
    const html = await page('?privacy=1&lang=fr');
    assert.match(html, /http:\/\/192\.168\.1\.20:\d+/);
  });
});
