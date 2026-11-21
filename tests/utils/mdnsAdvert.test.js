'use strict';

// The LAN announcement is a contract with the screens: `api=get` tells a TFT Panel it may ask
// /api/get, `version` is what the panel's page shows. Break the record and panels fall back to
// the bare lookup without a word, so it is pinned here.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { txtRecord, serviceHost } = require('../../src/utils/mdnsAdvert');

describe('mDNS TXT record', () => {
  test('carries the host, the Roon state, the version and the api contract', () => {
    const txt = txtRecord({ hostname: 'studio', roonEnabled: true, version: '0.7.1' });
    assert.deepEqual(txt, { hostname: 'studio', roon: 'yes', version: '0.7.1', api: 'get' });
  });

  test('a lyrics server alone says roon=no and still offers /api/get', () => {
    const txt = txtRecord({ hostname: 'nas', roonEnabled: false, version: '0.7.1' });
    assert.equal(txt.roon, 'no');
    assert.equal(txt.api, 'get');
  });

  test('every value is a string, as a TXT record requires', () => {
    const txt = txtRecord({ hostname: undefined, roonEnabled: false, version: undefined });
    for (const v of Object.values(txt)) assert.equal(typeof v, 'string');
    assert.equal(txt.version, 'unknown');
  });
});

describe('service host name', () => {
  test('is prefixed so mDNSResponder never sees a conflict with the Mac itself', () => {
    assert.equal(serviceHost('Vincents-Air.local'), 'tft-Vincents-Air.local');
    assert.equal(serviceHost('nas'), 'tft-nas.local');
  });
});
