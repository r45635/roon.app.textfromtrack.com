import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * SyncedLyrics — drop-in replacement for a static `<pre>` that displays LRC
 * content, with an optional "Sync" mode that highlights the active line
 * against the current Roon playback position and auto-scrolls.
 *
 * Same component is reused in three places (File Tags lyrics tab, LRCLIB
 * preview, TFT preview), each one independently togglable.
 *
 * Props:
 *   lrcText      — LRC/plain text. If no timestamps are detected, the Sync
 *                  toggle is disabled and we render the raw text.
 *   seekSeconds  — Latest Roon seek position (seconds) for the active zone.
 *   isPlaying    — true when the zone is actively playing; we interpolate
 *                  the highlight forward between polls only while playing.
 *   defaultSync  — initial state of the Sync toggle.
 *   compactHeader — when true, render the toggle inline-compact (used in
 *                  TFT/LRCLIB preview blocks where vertical space is tight).
 */
export default function SyncedLyrics({
  lrcText,
  seekSeconds = 0,
  isPlaying = false,
  defaultSync = false,
  compactHeader = false,
}) {
  const { t } = useTranslation();
  const [sync, setSync] = useState(defaultSync);

  // ── Parse LRC ──────────────────────────────────────────────────────────────
  // Lines are sorted by time; non-timed header tags ([ti:…], [ar:…], etc.) are
  // dropped. Plain (untimed) lyric lines are preserved with time=null and
  // never receive the "active" highlight.
  const parsed = useMemo(() => parseLrc(lrcText || ''), [lrcText]);
  const hasTimestamps = useMemo(() => parsed.some(l => l.time !== null), [parsed]);

  // ── Smooth playback interpolation ──────────────────────────────────────────
  // The seek_position prop only changes when the parent polls Roon (~ every
  // few seconds). For a smooth karaoke highlight we extrapolate locally:
  //   smooth = baseSeek + (now - baseTime) while playing
  // and snap back to the truth on every prop change.
  const baseRef = useRef({ seek: seekSeconds, time: Date.now() });
  useEffect(() => {
    baseRef.current = { seek: seekSeconds, time: Date.now() };
  }, [seekSeconds]);

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!sync || !isPlaying) return;
    const id = setInterval(() => forceTick(n => (n + 1) % 1_000_000), 200);
    return () => clearInterval(id);
  }, [sync, isPlaying]);

  const smoothSeek = sync && isPlaying
    ? baseRef.current.seek + (Date.now() - baseRef.current.time) / 1000
    : seekSeconds;

  // ── Active line lookup (binary search) ─────────────────────────────────────
  const activeIndex = useMemo(() => {
    if (!sync || !hasTimestamps) return -1;
    let lo = 0, hi = parsed.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = parsed[mid].time;
      if (t == null) { hi = mid - 1; continue; }
      if (t <= smoothSeek) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }, [parsed, smoothSeek, sync, hasTimestamps]);

  // ── Auto-scroll active line into view ──────────────────────────────────────
  const activeRef = useRef(null);
  const streamRef = useRef(null);
  useEffect(() => {
    if (!sync || activeIndex < 0 || !activeRef.current || !streamRef.current) return;
    const container = streamRef.current;
    const el = activeRef.current;
    const containerTop = container.getBoundingClientRect().top;
    const elTop = el.getBoundingClientRect().top;
    const offset = elTop - containerTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollBy({ top: offset, behavior: 'smooth' });
  }, [activeIndex, sync]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const toggle = (
    <label className={`synced-toggle${compactHeader ? ' compact' : ''}`} title={!hasTimestamps ? t('lyrics.sync_disabled') : ''}>
      <input
        type="checkbox"
        checked={sync && hasTimestamps}
        disabled={!hasTimestamps}
        onChange={e => setSync(e.target.checked)}
      />
      <span>{t('lyrics.sync_label')}</span>
    </label>
  );

  if (!sync || !hasTimestamps) {
    return (
      <div className="synced-lyrics">
        <div className="synced-header">{toggle}</div>
        <pre className="synced-static">{lrcText}</pre>
      </div>
    );
  }

  return (
    <div className="synced-lyrics syncing">
      <div className="synced-header">{toggle}</div>
      <div className="synced-stream" ref={streamRef} aria-live="polite">
        {parsed.map((line, i) => {
          const isActive = i === activeIndex;
          // Skip untimed lines in sync mode so the highlight is always meaningful
          if (line.time == null) return null;
          return (
            <div
              key={i}
              ref={isActive ? activeRef : null}
              className={`synced-line${isActive ? ' active' : ''}${i < activeIndex ? ' past' : ''}`}
              data-t={line.time.toFixed(2)}
            >
              {line.text || '​'}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── LRC parsing ────────────────────────────────────────────────────────────

// Matches one or more leading timestamps: [mm:ss.xx] or [mm:ss]
// Allowing multiple is the LRC standard for repeating the same line text.
const TIMESTAMP_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

// LRC header/metadata tag names (3-letter lowercase keys). We drop these.
const HEADER_TAG_RE = /^\[(ti|ar|al|au|by|length|offset|re|ve|tool|encoding|lang):/i;

function parseLrc(text) {
  const out = [];
  if (!text || typeof text !== 'string') return out;
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
      stamps.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]));
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

// Exported for unit testing / re-use
SyncedLyrics.parseLrc = parseLrc;
