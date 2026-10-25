'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { getLanAddress } = require('../../src/utils/lanAddress');

const v4 = (address, internal = false) => ({ family: 'IPv4', address, internal });

describe('getLanAddress', () => {
  test('skips a self-assigned 169.254 address listed first (MacBook Air, 2026-10-25)', () => {
    assert.equal(getLanAddress({
      lo0: [v4('127.0.0.1', true)],
      en4: [v4('169.254.171.87')],
      en0: [v4('192.168.2.30')],
      utun4: [v4('100.105.217.2')],
    }), '192.168.2.30');
  });

  test('prefers the Wi-Fi/Ethernet LAN address over Docker and VM bridges', () => {
    assert.equal(getLanAddress({
      docker0: [v4('172.17.0.1')],
      vmnet8: [v4('192.168.56.1')],
      eth0: [v4('10.0.0.12')],
    }), '10.0.0.12');
  });

  test('falls back to a public address, or null when nothing fits', () => {
    assert.equal(getLanAddress({ eth0: [v4('203.0.113.4')] }), '203.0.113.4');
    assert.equal(getLanAddress({ lo: [v4('127.0.0.1', true)], tailscale0: [v4('100.64.1.2')] }), null);
  });
});
