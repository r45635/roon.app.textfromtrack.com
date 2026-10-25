'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, getUpdateInfo } = require('../../src/utils/updateCheck');

describe('updateCheck', () => {
  test('compareVersions', () => {
    assert.equal(compareVersions('0.4.1', '0.4.0'), 1);
    assert.equal(compareVersions('v0.10.0', '0.9.9'), 1);
    assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
    assert.equal(compareVersions('0.4', '0.4.0'), 0);
    assert.equal(compareVersions('0.3.19', '0.4.0'), -1);
    assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), 0);
  });

  test('UPDATE_CHECK=false never asks GitHub', async () => {
    process.env.UPDATE_CHECK = 'false';
    try {
      const info = await getUpdateInfo();
      assert.equal(info.enabled, false);
      assert.equal(info.update_available, false);
      assert.equal(info.latest, null);
    } finally {
      delete process.env.UPDATE_CHECK;
    }
  });
});
