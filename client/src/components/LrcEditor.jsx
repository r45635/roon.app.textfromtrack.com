import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { parseLrc, hasTimestamps, formatStamp } from '../lib/lrc.js';

const NUDGE_S = 0.1;

function initialLines(text, offsetMs) {
  if (hasTimestamps(text)) {
    return parseLrc(text)
      .filter(l => l.time != null)
      .map(l => ({ time: Math.max(0, l.time + offsetMs / 1000), text: l.text }));
  }
  return (text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !/^\[[a-z]+:.*\]$/i.test(l))
    .map(l => ({ time: null, text: l }));
}

/**
 * LRC editor: stamp each line with the Roon playback position while the track plays.
 * Space = stamp the current line and go to the next, Backspace = undo the last stamp,
 * [ / ] = nudge the current line by 0.1 s, arrows = move, double-click = play from a line.
 */
export default function LrcEditor({ np, text, offsetMs = 0, onSave, onCancel, onSeek }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState(() => initialLines(text, offsetMs));
  const [cur, setCur] = useState(() => {
    const i = initialLines(text, offsetMs).findIndex(l => l.time == null);
    return i < 0 ? 0 : i;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);
  const curRef = useRef(null);

  // Playback position, interpolated between Roon polls (like SyncedLyrics).
  const baseRef = useRef({ seek: np?.seek_position_seconds ?? 0, time: Date.now() });
  useEffect(() => {
    baseRef.current = { seek: np?.seek_position_seconds ?? 0, time: Date.now() };
  }, [np?.seek_position_seconds]);
  const playing = np?.state === 'playing';
  const [, tick] = useState(0);
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => tick(n => (n + 1) % 1e6), 100);
    return () => clearInterval(id);
  }, [playing]);
  const position = () => (playing
    ? baseRef.current.seek + (Date.now() - baseRef.current.time) / 1000
    : baseRef.current.seek);

  useEffect(() => { boxRef.current?.focus(); }, []);
  useEffect(() => { curRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' }); }, [cur]);

  const timed = useMemo(() => lines.filter(l => l.time != null).length, [lines]);

  function setTime(i, time) {
    setLines(ls => ls.map((l, j) => (j === i ? { ...l, time: time == null ? null : Math.max(0, time) } : l)));
  }

  function stamp() {
    if (cur >= lines.length) return;
    setTime(cur, Math.round(position() * 100) / 100);
    setCur(c => Math.min(c + 1, lines.length));
  }

  function undo() {
    const prev = Math.max(0, cur - 1);
    setTime(prev, null);
    setCur(prev);
  }

  function nudge(delta) {
    const line = lines[cur];
    if (line && line.time != null) setTime(cur, Math.round((line.time + delta) * 100) / 100);
  }

  function onKeyDown(e) {
    if (e.key === ' ') { e.preventDefault(); stamp(); }
    else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCur(c => Math.min(c + 1, lines.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCur(c => Math.max(c - 1, 0)); }
    else if (e.key === '[') { e.preventDefault(); nudge(-NUDGE_S); }
    else if (e.key === ']') { e.preventDefault(); nudge(NUDGE_S); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }

  async function save() {
    const lrc = lines
      .filter(l => l.time != null)
      .sort((a, b) => a.time - b.time)
      .map(l => `${formatStamp(l.time)}${l.text}`)
      .join('\n');
    setSaving(true);
    setError(null);
    try {
      await onSave(lrc);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="lrc-editor">
      <div className="lrc-editor-bar">
        <button type="button" className="btn btn-primary btn-sm lrc-stamp" onClick={() => { stamp(); boxRef.current?.focus(); }} disabled={cur >= lines.length}>
          {t('editor.stamp')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { undo(); boxRef.current?.focus(); }} disabled={cur === 0 && lines[0]?.time == null}>
          {t('editor.undo')}
        </button>
        <span className="lrc-editor-pos tft-mono">{formatStamp(position())}</span>
        <span className="muted small">{t('editor.progress', { timed, total: lines.length })}</span>
        <span className="lrc-editor-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || timed === 0}>
            {saving ? t('stage.saving') : t('editor.save')}
          </button>
        </span>
      </div>
      <p className="muted small">{t('editor.help')}</p>
      {!playing && <p className="small lrc-editor-warn">{t('editor.not_playing')}</p>}
      {timed > 0 && timed < lines.length && <p className="small lrc-editor-warn">{t('editor.untimed_dropped', { count: lines.length - timed })}</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
      <ol
        className="lrc-editor-lines"
        ref={boxRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={t('editor.lines_label')}
      >
        {lines.map((l, i) => (
          <li
            key={i}
            ref={i === cur ? curRef : null}
            className={`lrc-editor-line${i === cur ? ' current' : ''}${l.time == null ? ' untimed' : ''}`}
            onClick={() => setCur(i)}
            onDoubleClick={() => { if (l.time != null && np?.is_seek_allowed) onSeek?.('absolute', l.time); }}
          >
            <span className="lrc-editor-time tft-mono">{l.time == null ? '--:--.--' : formatStamp(l.time).slice(1, -1)}</span>
            <span className="lrc-editor-text">{l.text || '♪'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
