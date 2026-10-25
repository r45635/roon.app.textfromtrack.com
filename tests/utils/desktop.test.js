'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');

// Record execFile calls instead of opening windows; desktop.js must be loaded after this.
const calls = [];
let nextError = null;
const realExecFile = childProcess.execFile;
childProcess.execFile = (cmd, args, cb) => { calls.push([cmd, args]); cb(nextError); };
const desktop = require('../../src/utils/desktop');

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
function onPlatform(platform, fn) {
  Object.defineProperty(process, 'platform', { value: platform });
  try { fn(); } finally { Object.defineProperty(process, 'platform', realPlatform); }
}

before(() => { calls.length = 0; });
after(() => { childProcess.execFile = realExecFile; });

describe('desktop', () => {
  test('macOS: open / open -R', () => {
    onPlatform('darwin', () => {
      desktop.openFolder('/m/a', () => {});
      desktop.revealFile('/m/a/x.flac', () => {});
    });
    assert.deepEqual(calls.splice(0), [['open', ['/m/a']], ['open', ['-R', '/m/a/x.flac']]]);
  });

  test('Windows: explorer, exit code 1 is success', () => {
    nextError = Object.assign(new Error('exit 1'), { code: 1 });
    let result = 'unset';
    onPlatform('win32', () => desktop.revealFile('C:\\m\\x.flac', (err) => { result = err; }));
    nextError = null;
    assert.deepEqual(calls.splice(0), [['explorer.exe', ['/select,C:\\m\\x.flac']]]);
    assert.equal(result, null);
  });

  test('Linux: xdg-open on the folder, errors passed on', () => {
    nextError = new Error('spawn xdg-open ENOENT');
    let result = null;
    onPlatform('linux', () => desktop.revealFile('/m/a/x.flac', (err) => { result = err; }));
    nextError = null;
    assert.deepEqual(calls.splice(0), [['xdg-open', ['/m/a']]]);
    assert.match(result.message, /ENOENT/);
  });
});
