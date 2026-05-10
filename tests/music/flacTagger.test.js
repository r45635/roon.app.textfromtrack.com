'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readFlac,
  parseVorbisComment,
  formatVorbisComment,
  buildFlac,
  applyLyricsUpdate,
  setLyrics,
} = require('../../src/music/flacTagger');

// ─── Synthetic FLAC builder ───────────────────────────────────────────────────
//
// We build a tiny but spec-valid FLAC with:
//   STREAMINFO (34 bytes of zeros — semantically meaningless but structurally OK)
//   PICTURE    (small fake picture block — to verify it survives a round-trip)
//   APPLICATION (small block — to verify generic preservation)
//   VORBIS_COMMENT (vendor + a few tags including a LYRICS line)
// Followed by a single byte of fake audio frames (we don't care about decode-validity).

const STREAMINFO = 0;
const APPLICATION = 2;
const VORBIS_COMMENT = 4;
const PICTURE = 6;

function block(type, payload, isLast = false) {
  const header = Buffer.alloc(4);
  header.writeUInt8((isLast ? 0x80 : 0) | (type & 0x7f), 0);
  header.writeUIntBE(payload.length, 1, 3);
  return Buffer.concat([header, payload]);
}

function buildSyntheticFlac({ vendor = 'reference libFLAC 1.3.0', tags = [], extraBlocks = [] }) {
  const streamInfo = Buffer.alloc(34); // zeros
  const vc = formatVorbisComment(vendor, tags);

  const parts = [Buffer.from('fLaC', 'ascii')];
  parts.push(block(STREAMINFO, streamInfo, false));
  for (const b of extraBlocks) {
    parts.push(block(b.type, b.payload, false));
  }
  parts.push(block(VORBIS_COMMENT, vc, true)); // mark VC as last for our minimal synthetic file
  parts.push(Buffer.from([0xff])); // single placeholder audio byte
  return Buffer.concat(parts);
}

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-flac-test-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFile(name, buf) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, buf);
  return p;
}

// ─── readFlac / parseVorbisComment round-trip ─────────────────────────────────

describe('readFlac + parseVorbisComment', () => {
  test('reads vendor + tags from a synthetic FLAC', () => {
    const flac = buildSyntheticFlac({
      vendor: 'unit test',
      tags: ['ARTIST=Foo', 'ALBUM=Bar', 'TITLE=Baz'],
    });
    const { blocks } = readFlac(flac);
    const vc = blocks.find(b => b.type === VORBIS_COMMENT);
    assert.ok(vc, 'VORBIS_COMMENT block should exist');
    const parsed = parseVorbisComment(vc.payload);
    assert.equal(parsed.vendorString, 'unit test');
    assert.deepEqual(parsed.tags, ['ARTIST=Foo', 'ALBUM=Bar', 'TITLE=Baz']);
  });

  test('throws on a non-FLAC buffer', () => {
    assert.throws(() => readFlac(Buffer.from('not a flac file')), /not a FLAC/i);
  });
});

// ─── applyLyricsUpdate ────────────────────────────────────────────────────────

describe('applyLyricsUpdate', () => {
  test('appends LYRICS when none exists', () => {
    const before = ['ARTIST=Foo', 'ALBUM=Bar'];
    const after = applyLyricsUpdate(before, '[00:01]hi');
    assert.deepEqual(after, ['ARTIST=Foo', 'ALBUM=Bar', 'LYRICS=[00:01]hi']);
  });

  test('renames existing LYRICS to LYRICS.ORG and appends new LYRICS', () => {
    const before = ['ARTIST=Foo', 'LYRICS=old content', 'ALBUM=Bar'];
    const after = applyLyricsUpdate(before, '[00:01]new');
    assert.deepEqual(after, [
      'ARTIST=Foo',
      'ALBUM=Bar',
      'LYRICS.ORG=old content',
      'LYRICS=[00:01]new',
    ]);
  });

  test('overwrites pre-existing LYRICS.ORG when LYRICS is also present', () => {
    const before = ['LYRICS.ORG=very old', 'LYRICS=current', 'ARTIST=Foo'];
    const after = applyLyricsUpdate(before, 'newest');
    // LYRICS.ORG=very old must be dropped (it is replaced by LYRICS=current's
    // value), then current LYRICS becomes LYRICS.ORG, then LYRICS=newest is added
    assert.deepEqual(after, ['ARTIST=Foo', 'LYRICS.ORG=current', 'LYRICS=newest']);
  });

  test('preserves LYRICS.ORG when no current LYRICS exists', () => {
    // Edge case: LYRICS.ORG is present but no LYRICS — we should not touch
    // LYRICS.ORG in this case.
    const before = ['LYRICS.ORG=ancient backup', 'ARTIST=Foo'];
    const after = applyLyricsUpdate(before, 'first ever');
    assert.deepEqual(after, ['LYRICS.ORG=ancient backup', 'ARTIST=Foo', 'LYRICS=first ever']);
  });

  test('field-name comparison is case-insensitive', () => {
    const before = ['lyrics=lower'];
    const after = applyLyricsUpdate(before, 'NEW');
    assert.deepEqual(after, ['LYRICS.ORG=lower', 'LYRICS=NEW']);
  });
});

// ─── setLyrics: full file round-trip preserves every block ────────────────────

describe('setLyrics — preserves all metadata blocks', () => {
  test('preserves PICTURE + APPLICATION blocks and all other tags', () => {
    const fakePicture = Buffer.alloc(20, 0x55); // not a real picture, but a non-zero block
    const fakeApp = Buffer.alloc(8, 0xaa);
    const flac = buildSyntheticFlac({
      vendor: 'preserve-test',
      tags: ['ARTIST=Alice', 'ALBUM=Best Of', 'TITLE=Track 1', 'GENRE=Test'],
      extraBlocks: [
        { type: APPLICATION, payload: fakeApp },
        { type: PICTURE, payload: fakePicture },
      ],
    });
    const filePath = makeFile('preserve.flac', flac);

    setLyrics(filePath, '[00:01]hello');

    const out = fs.readFileSync(filePath);
    const { blocks, framesBuffer } = readFlac(out);

    // All four block types must still be there
    assert.equal(blocks.filter(b => b.type === STREAMINFO).length, 1);
    assert.equal(blocks.filter(b => b.type === APPLICATION).length, 1);
    assert.equal(blocks.filter(b => b.type === PICTURE).length, 1);
    assert.equal(blocks.filter(b => b.type === VORBIS_COMMENT).length, 1);

    // The picture and application payloads must be byte-for-byte unchanged
    assert.ok(blocks.find(b => b.type === PICTURE).payload.equals(fakePicture));
    assert.ok(blocks.find(b => b.type === APPLICATION).payload.equals(fakeApp));

    // Frames buffer is unchanged
    assert.ok(framesBuffer.equals(Buffer.from([0xff])));

    // Tags: original 4 + new LYRICS = 5
    const vc = parseVorbisComment(blocks.find(b => b.type === VORBIS_COMMENT).payload);
    assert.equal(vc.vendorString, 'preserve-test');
    assert.equal(vc.tags.length, 5);
    assert.ok(vc.tags.includes('ARTIST=Alice'));
    assert.ok(vc.tags.includes('ALBUM=Best Of'));
    assert.ok(vc.tags.includes('TITLE=Track 1'));
    assert.ok(vc.tags.includes('GENRE=Test'));
    assert.ok(vc.tags.includes('LYRICS=[00:01]hello'));
  });

  test('renames existing LYRICS to LYRICS.ORG on second call', () => {
    const flac = buildSyntheticFlac({
      vendor: 'rename-test',
      tags: ['ARTIST=Bob', 'LYRICS=old lyrics'],
    });
    const filePath = makeFile('rename.flac', flac);

    setLyrics(filePath, 'brand new lyrics');

    const out = fs.readFileSync(filePath);
    const { blocks } = readFlac(out);
    const vc = parseVorbisComment(blocks.find(b => b.type === VORBIS_COMMENT).payload);

    assert.ok(vc.tags.includes('ARTIST=Bob'));
    assert.ok(vc.tags.includes('LYRICS.ORG=old lyrics'));
    assert.ok(vc.tags.includes('LYRICS=brand new lyrics'));
  });

  test('handles lyrics with newlines and unicode (real LRC content)', () => {
    const flac = buildSyntheticFlac({
      vendor: 'unicode-test',
      tags: ['ARTIST=日本語'],
    });
    const filePath = makeFile('unicode.flac', flac);

    const lrc = '[00:01.00]Bonjour le monde\n[00:03.50]你好世界 ✓';
    setLyrics(filePath, lrc);

    const out = fs.readFileSync(filePath);
    const { blocks } = readFlac(out);
    const vc = parseVorbisComment(blocks.find(b => b.type === VORBIS_COMMENT).payload);

    assert.ok(vc.tags.includes('ARTIST=日本語'));
    const lyricsTag = vc.tags.find(t => t.startsWith('LYRICS='));
    assert.equal(lyricsTag, `LYRICS=${lrc}`);
  });
});

// ─── buildFlac is-last flag invariant ─────────────────────────────────────────

describe('buildFlac', () => {
  test('forces the is-last flag on the final block only', () => {
    const sample = buildSyntheticFlac({
      vendor: 'flag-test',
      tags: ['A=1'],
    });
    const { blocks, framesBuffer } = readFlac(sample);
    // Manually un-flag everything, then let buildFlac correct it
    const messed = blocks.map(b => ({ ...b, isLast: true })); // intentionally wrong
    const rebuilt = buildFlac(messed, framesBuffer);
    const reread = readFlac(rebuilt).blocks;
    for (let i = 0; i < reread.length; i++) {
      assert.equal(reread[i].isLast, i === reread.length - 1);
    }
  });
});
