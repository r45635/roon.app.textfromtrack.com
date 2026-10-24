'use strict';

// electron-builder afterPack hook (macOS): give every executable a unique
// Mach-O LC_UUID before the bundle is signed.
//
// Electron ships the same binary to every app, so our main executable carried
// Electron's own UUID. macOS Local Network privacy identifies a process by that
// UUID (Apple TN3179): with the UUID shared by every Electron app of the same
// version, it could not attribute our connections to this app — no permission
// prompt, no entry in Privacy & Security → Local Network, LAN silently blocked.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const LC_UUID = 0x1b;

// Deterministic per app / executable / architecture, shaped as a v5 UUID.
function makeUuid(seed) {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

// Rewrite LC_UUID of the thin 64-bit Mach-O starting at `offset`. Returns true if found.
function patchThin(buf, offset, seed) {
  if (buf.readUInt32LE(offset) !== MH_MAGIC_64) return false;
  const cputype = buf.readUInt32LE(offset + 4);
  const ncmds = buf.readUInt32LE(offset + 16);
  let cmd = offset + 32;
  for (let i = 0; i < ncmds; i++) {
    const type = buf.readUInt32LE(cmd);
    const size = buf.readUInt32LE(cmd + 4);
    if (type === LC_UUID) {
      makeUuid(`${seed}:${cputype}`).copy(buf, cmd + 8);
      return true;
    }
    cmd += size;
  }
  return false;
}

function patchExecutable(file, seed) {
  const buf = fs.readFileSync(file);
  let patched = 0;
  if (buf.readUInt32BE(0) === FAT_MAGIC) {
    const narch = buf.readUInt32BE(4);
    for (let i = 0; i < narch; i++) {
      if (patchThin(buf, buf.readUInt32BE(8 + i * 20 + 8), seed)) patched++;
    }
  } else if (patchThin(buf, 0, seed)) {
    patched++;
  }
  if (!patched) throw new Error(`no LC_UUID found in ${file}`);
  fs.writeFileSync(file, buf);
  return patched;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const { productFilename } = context.packager.appInfo;
  const appId = context.packager.appInfo.id;
  const contents = path.join(context.appOutDir, `${productFilename}.app`, 'Contents');

  const executables = [path.join(contents, 'MacOS', productFilename)];
  const frameworks = path.join(contents, 'Frameworks');
  for (const entry of fs.readdirSync(frameworks)) {
    if (!entry.endsWith('.app')) continue;
    const name = entry.slice(0, -'.app'.length);
    executables.push(path.join(frameworks, entry, 'Contents', 'MacOS', name));
  }

  for (const exe of executables) {
    patchExecutable(exe, `${appId}:${path.basename(exe)}`);
    console.log(`  • unique LC_UUID  file=${path.relative(context.appOutDir, exe)}`);
  }
};
