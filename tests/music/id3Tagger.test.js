'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const id3 = require('../../src/music/id3Tagger');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-id3-test-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// ─── Fixture builders ─────────────────────────────────────────────────────────

const synchsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

function frame(id, payload, version = 3) {
  let size;
  if (version === 4) size = synchsafe(payload.length);
  else { size = Buffer.alloc(4); size.writeUInt32BE(payload.length); }
  return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.from([0, 0]), payload]);
}

const utf16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);

/** Unsynchronisation as a writer applies it: a 0x00 after every 0xFF. */
function unsync(buf) {
  const out = [];
  for (const byte of buf) { out.push(byte); if (byte === 0xff) out.push(0); }
  return Buffer.from(out);
}

function tag(frames, { version = 3, flags = 0, padding = 64 } = {}) {
  let body = Buffer.concat([...frames, Buffer.alloc(padding)]);
  if (flags & 0x80) body = unsync(body);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, flags]), synchsafe(body.length), body]);
}

/** Six valid MPEG-1 Layer III frames (128 kbps, 44.1 kHz) and an ID3v1 tag. */
function audio() {
  const frames = [];
  for (let i = 0; i < 6; i++) {
    const f = Buffer.alloc(417, i + 1);
    f.writeUInt32BE(0xfffb9064, 0);
    frames.push(f);
  }
  const v1 = Buffer.alloc(128);
  v1.write('TAG', 0); v1.write('The Nest', 3); v1.write('//www.joshwoodward.com', 97);
  return Buffer.concat([...frames, v1]);
}

// The frames that node-id3 mangled on a real file: two COMM frames, one with a "\0\0\0" language.
const ORIGINAL_FRAMES = [
  frame('TIT2', Buffer.concat([Buffer.from([1]), utf16('The Nest')])),
  frame('COMM', Buffer.concat([Buffer.from([0]), Buffer.from('XXX'), Buffer.from('ID3v1 Comment\0'), Buffer.from('//www.joshwoodward.com')])),
  frame('COMM', Buffer.concat([Buffer.from([0]), Buffer.from([0, 0, 0]), Buffer.from('http\0'), Buffer.from('//www.joshwoodward.com')])),
  frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3]), Buffer.from('\0'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 255, 0, 7])])),
  frame('TXXX', Buffer.concat([Buffer.from([1]), utf16('Source\0'), Buffer.from([0]), utf16('Free Music Archive')])),
];

let n = 0;
function file(buffer) {
  const p = path.join(tmpDir, `t${++n}.mp3`);
  fs.writeFileSync(p, buffer);
  return p;
}

async function parse(p) {
  const { parseFile } = await import('music-metadata');
  return parseFile(p, { skipCovers: false });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('id3Tagger.setLyrics', () => {
  test('adds lyrics and keeps every other frame and the audio byte-for-byte', async () => {
    const p = file(Buffer.concat([tag(ORIGINAL_FRAMES), audio()]));
    const before = await parse(p);

    const lrc = '[00:07.07]The broken wing, it didn\'t last a spring\n[00:22.07]Éte — ça marche';
    const result = id3.setLyrics(p, lrc);
    assert.deepEqual(result, { removed: 0, kept: 5, added: 1 });

    const buf = fs.readFileSync(p);
    const tagAfter = id3.readId3(buf);
    assert.deepEqual(tagAfter.frames.slice(0, 5).map(f => f.raw), ORIGINAL_FRAMES);
    assert.ok(tagAfter.audio.equals(audio()), 'audio frames and ID3v1 tag unchanged');

    const after = await parse(p);
    assert.deepEqual(after.common.comment, before.common.comment);
    assert.equal(after.common.title, 'The Nest');
    assert.equal(after.common.picture?.[0]?.data.length, 10);
    const uslt = after.native['ID3v2.3'].find(t => t.id === 'USLT');
    assert.equal(uslt.value.text, lrc);
    assert.equal(uslt.value.descriptor, 'LYRICS');
  });

  test('replaces existing lyrics instead of adding a second frame', () => {
    const p = file(Buffer.concat([tag(ORIGINAL_FRAMES), audio()]));
    id3.setLyrics(p, '[00:01.00]first');
    const result = id3.setLyrics(p, '[00:01.00]second');
    assert.equal(result.removed, 1);
    const usltFrames = id3.readId3(fs.readFileSync(p)).frames.filter(f => f.id === 'USLT');
    assert.equal(usltFrames.length, 1);
  });

  test('creates an ID3v2.3 tag on a file without one', async () => {
    const p = file(audio());
    id3.setLyrics(p, '[00:01.00]hello');
    const t = id3.readId3(fs.readFileSync(p));
    assert.equal(t.hadTag, true);
    assert.equal(t.version, 3);
    assert.ok(t.audio.equals(audio()));
    const after = await parse(p);
    assert.equal(after.native['ID3v2.3'].find(x => x.id === 'USLT').value.text, '[00:01.00]hello');
  });

  test('writes ID3v2.4 frames with synchsafe sizes and UTF-8 text', async () => {
    const v4Frames = [frame('TIT2', Buffer.concat([Buffer.from([3]), Buffer.from('Wake Up')]), 4)];
    const p = file(Buffer.concat([tag(v4Frames, { version: 4 }), audio()]));
    id3.setLyrics(p, '[00:01.00]réveil');
    const after = await parse(p);
    assert.equal(after.common.title, 'Wake Up');
    assert.equal(after.native['ID3v2.4'].find(x => x.id === 'USLT').value.text, '[00:01.00]réveil');
  });

  test('reads an unsynchronised ID3v2.3 tag and writes it back plain, frames unchanged', async () => {
    // Seen on a real file ("Wake Up"): the APIC bytes contain 0xFF, escaped in the file
    const p = file(Buffer.concat([tag(ORIGINAL_FRAMES, { flags: 0x80 }), audio()]));
    id3.setLyrics(p, '[00:01.00]wake up');
    const buf = fs.readFileSync(p);
    assert.equal(buf[5] & 0x80, 0, 'unsynchronisation flag cleared');
    assert.deepEqual(id3.readId3(buf).frames.slice(0, 5).map(f => f.raw), ORIGINAL_FRAMES);
    const after = await parse(p);
    assert.deepEqual(after.common.comment.map(c => c.text), ['//www.joshwoodward.com', '//www.joshwoodward.com']);
    assert.deepEqual([...after.common.picture[0].data], [0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 255, 0, 7]);
  });

  test('ID3v2.4 tag-level unsynchronisation moves to the frames that need it', async () => {
    // Seen on a real file ("Wake Up"): v2.4 with the tag-level flag set
    const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xe0, 0xff, 0x00, 7]);
    const apic = Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3]), Buffer.from('\0'), picture]);
    const frames = [
      frame('TIT2', Buffer.concat([Buffer.from([3]), Buffer.from('Wake Up')]), 4),
      frame('APIC', unsync(apic), 4),
    ];
    const body = Buffer.concat([...frames, Buffer.alloc(32)]);
    const p = file(Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0x80]), synchsafe(body.length), body, audio()]));
    id3.setLyrics(p, '[00:01.00]wake up');
    const buf = fs.readFileSync(p);
    assert.equal(buf[5] & 0x80, 0, 'tag-level flag cleared');
    const t = id3.readId3(buf);
    assert.ok(t.frames[0].raw.equals(frames[0]), 'frame without 0xFF copied as is');
    assert.equal(t.frames[1].raw[9] & 0x02, 0x02, 'APIC carries its own unsynchronisation bit');
    const after = await parse(p);
    assert.equal(after.common.title, 'Wake Up');
    assert.ok(Buffer.from(after.common.picture[0].data).equals(picture));
  });

  test('refuses ID3v2.2 tags without touching the file', () => {
    for (const buf of [
      Buffer.concat([tag([], { version: 2 }), audio()]),
    ]) {
      const p = file(buf);
      assert.throws(() => id3.setLyrics(p, '[00:01.00]x'), /not supported/);
      assert.ok(fs.readFileSync(p).equals(buf));
    }
  });
});

describe('id3Tagger.removeLyrics', () => {
  test('removes only the lyrics frame', () => {
    const p = file(Buffer.concat([tag(ORIGINAL_FRAMES), audio()]));
    id3.setLyrics(p, '[00:01.00]x');
    assert.deepEqual(id3.removeLyrics(p), { removed: true });
    const t = id3.readId3(fs.readFileSync(p));
    assert.deepEqual(t.frames.map(f => f.raw), ORIGINAL_FRAMES);
  });

  test('leaves a file without lyrics untouched', () => {
    const buf = Buffer.concat([tag(ORIGINAL_FRAMES), audio()]);
    const p = file(buf);
    assert.deepEqual(id3.removeLyrics(p), { removed: false });
    assert.ok(fs.readFileSync(p).equals(buf));
  });
});

describe('id3Tagger.setTextFrames', () => {
  test('sets, replaces and clears fields, keeping the others', async () => {
    const p = file(Buffer.concat([tag(ORIGINAL_FRAMES), audio()]));
    id3.setTextFrames(p, { TIT2: 'The Nest (Remastered)', YEAR: '2016', TXXX: null, COMM: 'New comment' });
    const t = id3.readId3(fs.readFileSync(p));
    assert.deepEqual(t.frames.map(f => f.id), ['APIC', 'TIT2', 'TYER', 'COMM']);
    assert.ok(t.frames[0].raw.equals(ORIGINAL_FRAMES[3]), 'artwork kept byte-for-byte');
    const after = await parse(p);
    assert.equal(after.common.title, 'The Nest (Remastered)');
    assert.equal(after.common.year, 2016);
    assert.deepEqual(after.common.comment.map(c => c.text), ['New comment']);
  });
});
