'use strict';

/**
 * Minimal, conservative FLAC metadata editor.
 *
 * The metaflac-js2 npm package SILENTLY DROPS existing Vorbis tags and PICTURE
 * blocks because its parseVorbisComment() and parsePictureBlock() bodies are
 * commented out in source. Using it on a real library wipes album art and
 * every tag (artist, album, etc.) on save. We therefore implement our own
 * metadata-block preservation here.
 *
 * Reference: FLAC format, https://xiph.org/flac/format.html
 *  - 4 ASCII bytes "fLaC"
 *  - One or more METADATA_BLOCKs:
 *      - 1 byte:  bit 7 = is-last-flag, bits 0-6 = block type (0..6 = STREAMINFO,
 *                 PADDING, APPLICATION, SEEKTABLE, VORBIS_COMMENT, CUESHEET, PICTURE)
 *      - 3 bytes: block size (big-endian)
 *      - <size> bytes: payload
 *  - Audio frames
 *
 * VORBIS_COMMENT payload (little-endian lengths):
 *  - u32 vendor_length, vendor_string
 *  - u32 user_comment_list_length
 *  - For each comment: u32 length, "KEY=VALUE" UTF-8
 */

const fs = require('fs');

const VORBIS_COMMENT = 4;

/** @typedef {{ type: number, isLast: boolean, payload: Buffer }} FlacBlock */

/**
 * Read a FLAC file into ordered metadata blocks + frames buffer.
 * Throws if the file is not a FLAC.
 *
 * @param {Buffer} buffer
 * @returns {{ blocks: FlacBlock[], framesBuffer: Buffer }}
 */
function readFlac(buffer) {
  if (buffer.length < 4 || buffer.slice(0, 4).toString('ascii') !== 'fLaC') {
    throw new Error('Not a FLAC file (missing fLaC marker)');
  }
  const blocks = [];
  let offset = 4;
  let isLast = false;
  while (!isLast) {
    if (offset + 4 > buffer.length) {
      throw new Error('Unexpected end of file while reading metadata block header');
    }
    const headerByte = buffer.readUInt8(offset);
    isLast = (headerByte & 0x80) !== 0;
    const type = headerByte & 0x7f;
    const length = buffer.readUIntBE(offset + 1, 3);
    if (offset + 4 + length > buffer.length) {
      throw new Error('Block length runs past end of file');
    }
    const payload = buffer.slice(offset + 4, offset + 4 + length);
    blocks.push({ type, isLast, payload });
    offset += 4 + length;
  }
  return { blocks, framesBuffer: buffer.slice(offset) };
}

/**
 * Parse a VORBIS_COMMENT payload into vendor + tags array.
 * @param {Buffer} payload
 * @returns {{ vendorString: string, tags: string[] }}
 */
function parseVorbisComment(payload) {
  let offset = 0;
  if (payload.length < 4) return { vendorString: '', tags: [] };

  const vendorLen = payload.readUInt32LE(offset);
  offset += 4;
  if (offset + vendorLen > payload.length) {
    throw new Error('Vorbis comment: vendor length out of bounds');
  }
  const vendorString = payload.slice(offset, offset + vendorLen).toString('utf8');
  offset += vendorLen;

  if (offset + 4 > payload.length) return { vendorString, tags: [] };
  const count = payload.readUInt32LE(offset);
  offset += 4;

  const tags = [];
  for (let i = 0; i < count; i++) {
    if (offset + 4 > payload.length) {
      throw new Error(`Vorbis comment: truncated header for tag ${i}`);
    }
    const len = payload.readUInt32LE(offset);
    offset += 4;
    if (offset + len > payload.length) {
      throw new Error(`Vorbis comment: tag ${i} length runs past end`);
    }
    tags.push(payload.slice(offset, offset + len).toString('utf8'));
    offset += len;
  }
  return { vendorString, tags };
}

/**
 * Build a VORBIS_COMMENT payload from vendor + tags.
 * @param {string} vendorString
 * @param {string[]} tags  Each "KEY=VALUE", UTF-8.
 * @returns {Buffer}
 */
function formatVorbisComment(vendorString, tags) {
  const parts = [];
  const vendorBuf = Buffer.from(vendorString, 'utf8');
  const vendorLenBuf = Buffer.alloc(4);
  vendorLenBuf.writeUInt32LE(vendorBuf.length);
  parts.push(vendorLenBuf, vendorBuf);

  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(tags.length);
  parts.push(countBuf);

  for (const tag of tags) {
    const tagBuf = Buffer.from(tag, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(tagBuf.length);
    parts.push(lenBuf, tagBuf);
  }
  return Buffer.concat(parts);
}

/**
 * Encode a single metadata block (4-byte header + payload).
 * @param {FlacBlock} block
 * @returns {Buffer}
 */
function encodeBlock(block) {
  const header = Buffer.alloc(4);
  let typeByte = block.type & 0x7f;
  if (block.isLast) typeByte |= 0x80;
  header.writeUInt8(typeByte, 0);
  header.writeUIntBE(block.payload.length, 1, 3);
  return Buffer.concat([header, block.payload]);
}

/**
 * Reassemble a complete FLAC buffer from blocks + frames.
 * @param {FlacBlock[]} blocks
 * @param {Buffer} framesBuffer
 * @returns {Buffer}
 */
function buildFlac(blocks, framesBuffer) {
  if (blocks.length === 0) throw new Error('FLAC must have at least one metadata block');
  // Force is-last flag to be true on the final block, false on all others.
  const fixed = blocks.map((b, i) => ({ ...b, isLast: i === blocks.length - 1 }));
  const parts = [Buffer.from('fLaC', 'ascii'), ...fixed.map(encodeBlock), framesBuffer];
  return Buffer.concat(parts);
}

// ─── LYRICS-tag–specific logic ─────────────────────────────────────────────────

const LYRICS_KEY = 'LYRICS';
const LYRICS_ORG_KEY = 'LYRICS.ORG';

/**
 * Check whether two Vorbis comment field names match (case-insensitive).
 * @param {string} tag    A "KEY=VALUE" line.
 * @param {string} key    The key to compare against.
 */
function tagKeyEquals(tag, key) {
  const eq = tag.indexOf('=');
  if (eq < 0) return false;
  return tag.slice(0, eq).toUpperCase() === key.toUpperCase();
}

/**
 * Apply the user-defined LYRICS update rule to an existing tag list:
 *   - If a LYRICS tag exists, rename it to LYRICS.ORG, overwriting any
 *     pre-existing LYRICS.ORG.
 *   - Append the new LYRICS=<lrcContent> tag.
 * All other tags are preserved verbatim.
 *
 * @param {string[]} tags
 * @param {string} lrcContent
 * @returns {string[]}
 */
function applyLyricsUpdate(tags, lrcContent) {
  const existingLyrics = tags.find(t => tagKeyEquals(t, LYRICS_KEY));

  // Drop any pre-existing LYRICS.ORG when we are about to write a new one
  // (we always write one if a LYRICS tag was present).
  let next = tags;
  if (existingLyrics) {
    next = next.filter(t => !tagKeyEquals(t, LYRICS_ORG_KEY));
  }
  // Drop the old LYRICS line (we are replacing it).
  next = next.filter(t => !tagKeyEquals(t, LYRICS_KEY));
  if (existingLyrics) {
    const eq = existingLyrics.indexOf('=');
    next.push(`${LYRICS_ORG_KEY}=${existingLyrics.slice(eq + 1)}`);
  }
  next.push(`${LYRICS_KEY}=${lrcContent}`);
  return next;
}

/**
 * Write the LRC content into the file's LYRICS Vorbis comment, preserving
 * every other metadata block (album art, all other tags, seektable, …).
 *
 * @param {string} audioPath
 * @param {string} lrcContent
 * @returns {{ tagCountBefore: number, tagCountAfter: number, hadExistingLyrics: boolean }}
 */
function setLyrics(audioPath, lrcContent) {
  const buffer = fs.readFileSync(audioPath);
  const { blocks, framesBuffer } = readFlac(buffer);

  let vorbisIdx = blocks.findIndex(b => b.type === VORBIS_COMMENT);
  let vendorString = '';
  let tags = [];
  if (vorbisIdx >= 0) {
    const parsed = parseVorbisComment(blocks[vorbisIdx].payload);
    vendorString = parsed.vendorString;
    tags = parsed.tags;
  }
  const tagCountBefore = tags.length;
  const hadExistingLyrics = tags.some(t => tagKeyEquals(t, LYRICS_KEY));

  const newTags = applyLyricsUpdate(tags, lrcContent);
  const newPayload = formatVorbisComment(vendorString, newTags);

  if (vorbisIdx >= 0) {
    blocks[vorbisIdx] = { ...blocks[vorbisIdx], payload: newPayload };
  } else {
    // Insert the comment block right after STREAMINFO (index 0) to be safe.
    blocks.splice(1, 0, { type: VORBIS_COMMENT, isLast: false, payload: newPayload });
  }

  const newBuffer = buildFlac(blocks, framesBuffer);

  // Write atomically: tmp file + rename, so a crash mid-write never leaves a
  // half-written FLAC at the original path.
  const tmpPath = `${audioPath}.tft-tmp`;
  fs.writeFileSync(tmpPath, newBuffer);
  fs.renameSync(tmpPath, audioPath);

  // Verification: re-read and ensure preserved tag count is correct.
  const verify = parseVorbisComment(
    readFlac(fs.readFileSync(audioPath)).blocks.find(b => b.type === VORBIS_COMMENT).payload
  );
  const expectedAfter = hadExistingLyrics
    // we replaced LYRICS with LYRICS.ORG and added LYRICS again → +1 if no
    // pre-existing LYRICS.ORG, 0 otherwise
    ? newTags.length
    : tagCountBefore + 1;
  if (verify.tags.length !== expectedAfter) {
    throw new Error(
      `Tag preservation check failed: before=${tagCountBefore}, expected after=${expectedAfter}, got=${verify.tags.length}`
    );
  }

  return { tagCountBefore, tagCountAfter: verify.tags.length, hadExistingLyrics };
}

module.exports = {
  readFlac,
  parseVorbisComment,
  formatVorbisComment,
  buildFlac,
  applyLyricsUpdate,
  setLyrics,
  // exposed for tests
  _internals: { tagKeyEquals, encodeBlock },
};
