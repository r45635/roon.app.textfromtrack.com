import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLrc } from '../lib/lrc.js';

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
 *   alwaysSync   — no toggle: sync whenever the text has timestamps (lyrics stage).
 *   offsetMs     — user timing offset; positive shows each line later.
 *   onLineClick  — called with the line's playback time (seconds, offset
 *                  applied) when a timed line is clicked — used to seek Roon.
 *   className    — extra class on the root (e.g. 'synced-lyrics--stage').
 */
export default function SyncedLyrics({
  lrcText,
  seekSeconds = 0,
  isPlaying = false,
  defaultSync = false,
  compactHeader = false,
  alwaysSync = false,
  offsetMs = 0,
  onLineClick = null,
  className = '',
}) {
  const { t } = useTranslation();
  const [syncToggle, setSync] = useState(defaultSync);
  const sync = alwaysSync || syncToggle;

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

  const smoothSeek = (sync && isPlaying
    ? baseRef.current.seek + (Date.now() - baseRef.current.time) / 1000
    : seekSeconds) - offsetMs / 1000;

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
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    container.scrollBy({ top: offset, behavior: reduceMotion ? 'auto' : 'smooth' });
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

  const rootClass = className ? ` ${className}` : '';

  if (!sync || !hasTimestamps) {
    return (
      <div className={`synced-lyrics${rootClass}`}>
        {!alwaysSync && <div className="synced-header">{toggle}</div>}
        <pre className="synced-static">{alwaysSync ? stripTags(lrcText) : lrcText}</pre>
      </div>
    );
  }

  const LineTag = onLineClick ? 'button' : 'div';
  return (
    <div className={`synced-lyrics syncing${rootClass}`}>
      {!alwaysSync && <div className="synced-header">{toggle}</div>}
      {/* No aria-live: a screen reader would announce every line change. */}
      <div className="synced-stream" ref={streamRef}>
        {parsed.map((line, i) => {
          const isActive = i === activeIndex;
          // Skip untimed lines in sync mode so the highlight is always meaningful
          if (line.time == null) return null;
          return (
            <LineTag
              key={i}
              ref={isActive ? activeRef : null}
              className={`synced-line${isActive ? ' active' : ''}${i < activeIndex ? ' past' : ''}`}
              data-t={line.time.toFixed(2)}
              {...(onLineClick ? {
                type: 'button',
                onClick: () => onLineClick(line.time + offsetMs / 1000),
                title: t('lyrics.seek_to_line'),
              } : {})}
            >
              {/* An empty timed line is an instrumental break: show a note so the active line stays visible. */}
              {line.text || '♪'}
            </LineTag>
          );
        })}
      </div>
    </div>
  );
}

// Plain-lyrics display: drop LRC header tags like [ar:…] that some sources keep.
function stripTags(text) {
  return (text || '').split(/\r?\n/).filter(l => !/^\[[a-z]+:.*\]\s*$/i.test(l.trim())).join('\n');
}

// Exported for unit testing / re-use
SyncedLyrics.parseLrc = parseLrc;
