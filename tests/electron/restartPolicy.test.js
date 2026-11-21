'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { nextRestartDelay, DEFAULTS } = require('../../electron/restartPolicy');

describe('backend restart policy', () => {
  test('grants three restarts with growing delays, then gives up', () => {
    let history = [];
    const t0 = 1_000_000;
    const r1 = nextRestartDelay(history, t0);
    assert.equal(r1.delayMs, 2_000);
    const r2 = nextRestartDelay(r1.history, t0 + 10_000);
    assert.equal(r2.delayMs, 5_000);
    const r3 = nextRestartDelay(r2.history, t0 + 20_000);
    assert.equal(r3.delayMs, 15_000);
    const r4 = nextRestartDelay(r3.history, t0 + 30_000);
    assert.equal(r4.delayMs, null, 'the fourth crash in two minutes is for a human');
    assert.equal(r4.history.length, 3);
  });

  test('a crash after a quiet two minutes starts the count again', () => {
    const t0 = 5_000_000;
    let { history } = nextRestartDelay([], t0);
    ({ history } = nextRestartDelay(history, t0 + 1_000));
    ({ history } = nextRestartDelay(history, t0 + 2_000));
    const later = nextRestartDelay(history, t0 + DEFAULTS.windowMs + 3_000);
    assert.equal(later.delayMs, 2_000);
    assert.equal(later.history.length, 1);
  });

  test('tolerates a missing history', () => {
    assert.equal(nextRestartDelay(undefined, 42).delayMs, 2_000);
  });
});
