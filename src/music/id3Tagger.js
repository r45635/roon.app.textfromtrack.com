'use strict';

/**
 * Minimal, conservative ID3v2 frame editor for MP3 files.
 *
 * node-id3 rewrites every frame through its own encoder on update(), and
 * mangles the ones it doesn't fully understand: on a real file a COMM frame
 * with a "\0\0\0" language came back as mojibake, and a second COMM frame was
 * dropped. Like flacTagger.js for FLAC, this module only touches the frames it
 * is asked to change and copies every other frame byte-for-byte.
 *
 * Reference: ID3v2.3 / ID3v2.4, https://id3.org/id3v2.3.0 and id3v2.4.0-structure
 *  - 10-byte header: "ID3", major, revision, flags, size (4 × 7-bit synchsafe)
 *  - optional extended header (kept as is)
 *  - frames: 4-char id, size (v2.3: plain u32, v2.4: synchsafe), 2 flag bytes, payload
 *  - padding (zeros) up to the tag size
 *
 * ID3v2.3 tag-level unsynchronisation (0xFF 0x00 → 0xFF) is undone on read and
 * not applied on write — allowed by the spec, frame contents are unchanged. An
 * extended header is dropped on write: it only holds a CRC and padding info,
 * both stale once the tag changes.
 *
 * ID3v2.4 unsynchronisation is per frame: a frame that holds 0xFF bytes keeps
 * its data and gets its own unsynchronisation bit (the tag-level flag that said
 * "all frames" is dropped, since new frames are written plain).
 *
 * Refused (the file is left untouched): ID3v2.2 and v2.4 footers. Those are
 * rare and need a full decoder.
 */

const fs = require('fs');

const HEADER = 10;
const PADDING = 1024; // room for later edits without rewriting the audio

/** Undo unsynchronisation: every 0xFF 0x00 pair becomes 0xFF. */
function deunsync(buf) {
  const out = Buffer.alloc(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    out[j++] = buf[i];
    if (buf[i] === 0xff && buf[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function synchsafeToInt(buf, offset) {
  return ((buf[offset] & 0x7f) << 21) | ((buf[offset + 1] & 0x7f) << 14)
    | ((buf[offset + 2] & 0x7f) << 7) | (buf[offset + 3] & 0x7f);
}

function intToSynchsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

/**
 * Split an MP3 buffer into its ID3v2 tag (if any) and the rest.
 * @param {Buffer} buffer
 * @returns {{ version: 3|4, frames: { id: string, raw: Buffer }[], audio: Buffer, hadTag: boolean }}
 */
function readId3(buffer) {
  if (buffer.length < HEADER || buffer.toString('latin1', 0, 3) !== 'ID3') {
    return { version: 3, frames: [], audio: buffer, hadTag: false };
  }
  const version = buffer[3];
  const flags = buffer[5];
  if (version !== 3 && version !== 4) throw new Error(`ID3v2.${version} is not supported for writing`);
  if (version === 4 && (flags & 0x10)) throw new Error('ID3v2.4 tags with a footer are not supported for writing');

  const tagEnd = HEADER + synchsafeToInt(buffer, 6);
  if (tagEnd > buffer.length) throw new Error('ID3 tag runs past the end of the file');
  // v2.3 unsynchronises the whole tag; v2.4 does it per frame (handled below)
  const body = (flags & 0x80) && version === 3 ? deunsync(buffer.subarray(HEADER, tagEnd)) : buffer.subarray(HEADER, tagEnd);

  let offset = 0;
  if (flags & 0x40) {
    // v2.3: size excludes its own 4 bytes; v2.4: synchsafe size includes them
    offset += version === 3 ? body.readUInt32BE(0) + 4 : synchsafeToInt(body, 0);
  }

  const frames = [];
  while (offset + HEADER <= body.length) {
    if (body[offset] === 0) break; // padding
    const id = body.toString('latin1', offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) throw new Error(`Invalid ID3 frame id at byte ${HEADER + offset}`);
    const size = version === 4 ? synchsafeToInt(body, offset + 4) : body.readUInt32BE(offset + 4);
    const end = offset + HEADER + size;
    if (end > body.length) throw new Error(`ID3 frame ${id} runs past the end of the tag`);
    let raw = body.subarray(offset, end);
    if (version === 4 && (flags & 0x80) && !(raw[9] & 0x02) && raw.subarray(HEADER).includes(0xff)) {
      raw = Buffer.from(raw);
      raw[9] |= 0x02; // keep it unsynchronised without the tag-level flag
    }
    frames.push({ id, raw });
    offset = end;
  }

  return { version, frames, audio: buffer.subarray(tagEnd), hadTag: true };
}

/** Text in the frame's encoding: v2.4 → UTF-8 (3), v2.3 → UTF-16 with BOM (1). */
function encodeText(text, version, terminate) {
  if (version === 4) return Buffer.concat([Buffer.from(text, 'utf8'), terminate ? Buffer.from([0]) : Buffer.alloc(0)]);
  const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  return terminate ? Buffer.concat([body, Buffer.from([0, 0])]) : body;
}

function frame(id, payload, version) {
  const size = version === 4 ? intToSynchsafe(payload.length) : (() => { const b = Buffer.alloc(4); b.writeUInt32BE(payload.length); return b; })();
  return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.from([0, 0]), payload]);
}

/** T*** text frame (TIT2, TPE1, …). */
function textFrame(id, text, version) {
  return frame(id, Buffer.concat([Buffer.from([version === 4 ? 3 : 1]), encodeText(String(text), version, false)]), version);
}

/** USLT / COMM: encoding, 3-byte language, descriptor (terminated), text. */
function langTextFrame(id, { language = 'eng', descriptor = '', text }, version) {
  return frame(id, Buffer.concat([
    Buffer.from([version === 4 ? 3 : 1]),
    Buffer.from(language.padEnd(3, ' ').slice(0, 3), 'latin1'),
    encodeText(descriptor, version, true),
    encodeText(String(text), version, false),
  ]), version);
}

function buildTag(version, frameBuffers) {
  const body = Buffer.concat([...frameBuffers, Buffer.alloc(PADDING)]);
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([version, 0, 0]), intToSynchsafe(body.length)]);
  return Buffer.concat([header, body]);
}

/**
 * Remove every frame whose id is in `removeIds`, then append `add` (built frame buffers).
 * All other frames are copied byte-for-byte, then checked after the write.
 * @param {string} audioPath
 * @param {{ removeIds: string[], add: (version: 3|4) => Buffer[] }} change
 * @returns {{ removed: number, kept: number, added: number }}
 */
function updateFrames(audioPath, { removeIds, add }) {
  const buffer = fs.readFileSync(audioPath);
  const tag = readId3(buffer);
  const remove = new Set(removeIds);
  const kept = tag.frames.filter(f => !remove.has(f.id));
  const removed = tag.frames.length - kept.length;
  const added = add(tag.version);
  if (removed === 0 && added.length === 0) return { removed: 0, kept: kept.length, added: 0 };

  const out = Buffer.concat([
    buildTag(tag.version, [...kept.map(f => f.raw), ...added]),
    tag.audio,
  ]);

  // Write atomically: tmp file + rename, so a crash mid-write never leaves a half-written MP3.
  const tmpPath = `${audioPath}.tft-tmp`;
  fs.writeFileSync(tmpPath, out);
  fs.renameSync(tmpPath, audioPath);

  // Verification: every kept frame must come back identical, followed by the new ones.
  const check = readId3(fs.readFileSync(audioPath));
  const expected = [...kept.map(f => f.raw), ...added];
  if (check.frames.length !== expected.length || check.frames.some((f, i) => !f.raw.equals(expected[i]))) {
    throw new Error(`ID3 frame preservation check failed: expected ${expected.length} frames, got ${check.frames.length}`);
  }
  return { removed, kept: kept.length, added: added.length };
}

/** Replace the lyrics (every USLT frame) with one USLT frame. */
function setLyrics(audioPath, lrcContent) {
  return updateFrames(audioPath, {
    removeIds: ['USLT'],
    add: (v) => [langTextFrame('USLT', { language: 'eng', descriptor: 'LYRICS', text: lrcContent }, v)],
  });
}

/** Remove every USLT frame. */
function removeLyrics(audioPath) {
  const { removed } = updateFrames(audioPath, { removeIds: ['USLT'], add: () => [] });
  return { removed: removed > 0 };
}

/**
 * Set or clear text frames. `fields` maps a frame id to a string (set) or null/'' (remove).
 * 'COMM' replaces every comment frame with one. A year goes to TYER (v2.3) or TDRC (v2.4).
 * @param {string} audioPath
 * @param {Record<string, string|null>} fields
 */
function setTextFrames(audioPath, fields) {
  const ids = Object.keys(fields);
  const removeIds = ids.flatMap(id => (id === 'YEAR' ? ['TYER', 'TDRC'] : [id]));
  return updateFrames(audioPath, {
    removeIds,
    add: (v) => ids.flatMap((id) => {
      const value = fields[id];
      if (value == null || String(value).trim() === '') return [];
      if (id === 'COMM') return [langTextFrame('COMM', { language: 'eng', descriptor: '', text: value }, v)];
      if (id === 'YEAR') return [textFrame(v === 4 ? 'TDRC' : 'TYER', value, v)];
      return [textFrame(id, value, v)];
    }),
  });
}

module.exports = { readId3, setLyrics, removeLyrics, setTextFrames, updateFrames };
