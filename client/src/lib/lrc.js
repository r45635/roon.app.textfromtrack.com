// ─── LRC helpers ─────────────────────────────────────────────────────────────

// Matches one or more leading timestamps: [mm:ss.xx] or [mm:ss]
// Allowing multiple is the LRC standard for repeating the same line text.
const TIMESTAMP_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

// LRC header/metadata tag names. We drop these from the displayed lines.
const HEADER_TAG_RE = /^\[(ti|ar|al|au|by|length|offset|re|ve|tool|encoding|lang):/i;

// [offset:+/-ms] — positive means the lyrics come earlier (LRC convention).
const OFFSET_TAG_RE = /^\[offset:\s*([+-]?\d+)\s*\]/im;

/** True when the text holds at least one LRC timestamp line. */
export function hasTimestamps(text) {
  return /^\s*\[\d+:\d+(?:\.\d+)?\]/m.test(text || '');
}

/**
 * Parse LRC into lines sorted by time (seconds). Header tags are dropped; the
 * [offset:] tag is applied to every timestamp. Untimed lines keep time=null and
 * come first, in input order.
 */
export function parseLrc(text) {
  const out = [];
  if (!text || typeof text !== 'string') return out;
  const offsetTag = OFFSET_TAG_RE.exec(text);
  const tagShift = offsetTag ? parseInt(offsetTag[1], 10) / 1000 : 0;

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (HEADER_TAG_RE.test(raw)) continue;

    // Sentinel inserted by older TFT versions when no real timestamps were
    // available. We want to surface it as a single untimed informational line
    // so the user understands why sync is disabled.
    if (raw.includes('--- Timestamps not available for this model ---')) {
      out.push({ time: null, text: raw });
      continue;
    }

    TIMESTAMP_RE.lastIndex = 0;
    const stamps = [];
    let m;
    let lastEnd = 0;
    while ((m = TIMESTAMP_RE.exec(raw)) !== null) {
      stamps.push(Math.max(0, parseInt(m[1], 10) * 60 + parseFloat(m[2]) - tagShift));
      lastEnd = TIMESTAMP_RE.lastIndex;
    }
    const lineText = raw.slice(lastEnd).trim();

    if (stamps.length === 0) {
      out.push({ time: null, text: raw });
    } else {
      for (const t of stamps) out.push({ time: t, text: lineText });
    }
  }
  // Stable-sort by time, untimed lines preserved in input order at the front
  out.sort((a, b) => {
    if (a.time == null && b.time == null) return 0;
    if (a.time == null) return -1;
    if (b.time == null) return 1;
    return a.time - b.time;
  });
  return out;
}

function formatStamp(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const mm = Math.floor(cs / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  return `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}]`;
}

/**
 * Bake a user offset into the timestamps (positive = lyrics later) and drop any
 * [offset:] tag, so the exported file plays the same in every player.
 */
export function shiftLrc(text, offsetMs) {
  if (!text) return text;
  const tag = OFFSET_TAG_RE.exec(text);
  const shift = (offsetMs - (tag ? parseInt(tag[1], 10) : 0)) / 1000;
  if (!shift) return text;
  return text
    .split(/\r?\n/)
    .filter(line => !/^\[offset:/i.test(line.trim()))
    .map(line => line.replace(TIMESTAMP_RE, (_, mm, ss) => formatStamp(parseInt(mm, 10) * 60 + parseFloat(ss) + shift)))
    .join('\n');
}
