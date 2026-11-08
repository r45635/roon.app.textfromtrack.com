import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import SyncedLyrics from './SyncedLyrics.jsx';
import LyricsFullscreen from './LyricsFullscreen.jsx';
import LrcEditor from './LrcEditor.jsx';
import { useTrackLyrics } from '../hooks/useTrackLyrics.js';
import { shiftLrc, formatLength, isOtherLength } from '../lib/lrc.js';
import { describeError, lrclibProblem } from '../lib/errors.js';
import { qrPageUrl } from '../lib/qrPage.js';
import { maskAddresses } from '../lib/privacy.js';

const OFFSET_STEP_MS = 500;
const HINT_DISMISSED_KEY = 'tft:libraryHintDismissed';

function readDismissed() {
  try { return localStorage.getItem(HINT_DISMISSED_KEY) === '1'; } catch { return false; }
}

function fileSafe(s) {
  return (s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Lyrics stage — karaoke lyrics of the playing track, shown for every track
 * whether or not a local file matched (lyrics-only mode needs no music folder).
 *
 * Props:
 *   nowPlaying         — now-playing state
 *   path               — local file the user picked instead of the automatic match
 *   refreshKey         — bump to refetch (after a save elsewhere)
 *   libraryConfigured  — a music folder is set; false shows the "add your folder" hint
 *   onSeek(how, secs)  — seek Roon
 *   onControl(action)  — transport (full-screen view)
 *   onSaved()          — lyrics were written to the file
 *   onOpenSettings()   — open the settings drawer
 */
export default function LyricsStage({
  nowPlaying, path, refreshKey, libraryConfigured, onSeek, onControl, onSaved, onOpenSettings,
}) {
  const { t } = useTranslation();
  const np = nowPlaying;
  const { status, data, error, reload, setOffset, choose, saveCustom, markWrong } = useTrackLyrics(np, { path, refreshKey });
  const lyrics = data?.lyrics || null;

  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'ok'|'error', text }
  const [saving, setSaving] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(readDismissed);
  const [pasting, setPasting] = useState(false);

  // New track: close the versions picker and clear notices.
  const trackKey = np ? `${np.zone_id}|${np.title}|${np.artist}|${np.album}` : '';
  useEffect(() => { setVersionsOpen(false); setNotice(null); setEditing(false); setPasting(false); }, [trackKey]);

  const editingRef = useRef(false);
  editingRef.current = editing;

  // "F" toggles full screen (ignored while typing or editing timestamps).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (editingRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      setFullscreen(v => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!np || !np.title) return null;

  const found = !!(lyrics?.found && lyrics.text);
  const offsetMs = lyrics?.offset_ms || 0;
  const canSeek = !!np.is_seek_allowed;
  const canSave = found && !!data?.audio_path && (lyrics.source === 'lrclib' || lyrics.source === 'cache');

  function flash(tone, text) {
    setNotice({ tone, text });
    if (tone === 'ok') setTimeout(() => setNotice(n => (n?.text === text ? null : n)), 2500);
  }

  async function changeOffset(next) {
    try { await setOffset(next); } catch (err) { flash('error', t('stage.offset_failed', { msg: err.message })); }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(lyrics.text);
      flash('ok', t('stage.copied'));
    } catch {
      flash('error', t('stage.copy_failed'));
    }
  }

  function handleDownload() {
    const text = lyrics.synced ? shiftLrc(lyrics.text, offsetMs) : lyrics.text;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileSafe(np.artist)} - ${fileSafe(np.title)}.${lyrics.synced ? 'lrc' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/lrclib/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: data.audio_path,
          lrc_content: lyrics.synced ? shiftLrc(lyrics.text, offsetMs) : lyrics.text,
          title: np.title,
          artist: np.artist,
          album: np.album,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) throw Object.assign(new Error(body.error?.message || `HTTP ${res.status}`), { code: body.error?.code });
      // The offset is now baked into the file: drop it so it doesn't apply twice.
      if (offsetMs) await setOffset(0);
      flash('ok', body.lyrics_embedded ? t('stage.saved_embedded') : t('stage.saved_sidecar'));
      reload();
      onSaved?.();
    } catch (err) {
      flash('error', t('stage.save_failed', { msg: describeError(err) }));
    } finally {
      setSaving(false);
    }
  }

  async function handleWrong(wrong) {
    try {
      await markWrong(wrong);
      if (wrong) flash('ok', t('stage.wrong_done'));
    } catch (err) {
      flash('error', t('stage.wrong_failed', { msg: err.message }));
    }
  }

  // After editing, the lyrics live in the local cache: "Save to file" writes them when a file matched.
  const canSaveAfterEdit = !!data?.audio_path;

  const seekLine = canSeek ? (secs) => onSeek?.('absolute', Math.max(0, secs)) : null;

  let body;
  if (status === 'loading' && !data) {
    body = <p className="tft-lyrics-stage-msg">{t('stage.loading')}</p>;
  } else if (status === 'error') {
    body = (
      <div className="tft-lyrics-stage-msg">
        <p>{t('stage.load_failed', { msg: error })}</p>
        <button type="button" className="btn btn-ghost" onClick={() => reload(true)}>{t('common.retry')}</button>
      </div>
    );
  } else if (pasting) {
    body = (
      <PasteLyrics
        onCancel={() => setPasting(false)}
        onSave={async (text) => {
          await saveCustom(text);
          setPasting(false);
          flash('ok', canSaveAfterEdit ? t('editor.saved_file_hint') : t('editor.saved'));
        }}
      />
    );
  } else if (lyrics?.marked_wrong) {
    body = (
      <div className="tft-lyrics-stage-msg">
        <p>{t('stage.marked_wrong')}</p>
        <div className="tft-lyrics-stage-msg-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasting(true)}>{t('stage.paste')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setVersionsOpen(true); setQueueOpen(false); }}>{t('stage.versions')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleWrong(false)}>{t('stage.show_anyway')}</button>
        </div>
      </div>
    );
  } else if (lyrics?.instrumental) {
    body = <p className="tft-lyrics-stage-msg">{t('stage.instrumental')}</p>;
  } else if (found) {
    body = (
      <SyncedLyrics
        key={`${lyrics.track_id}|${lyrics.lrclib_id}|${lyrics.source}`}
        className="synced-lyrics--stage"
        lrcText={lyrics.text}
        seekSeconds={np.seek_position_seconds ?? 0}
        isPlaying={np.state === 'playing'}
        alwaysSync
        offsetMs={offsetMs}
        onLineClick={seekLine}
      />
    );
  } else if (lyrics?.error) {
    body = (
      <div className="tft-lyrics-stage-msg">
        <p title={maskAddresses(lyrics.error)}>{lrclibProblem(lyrics.error)}</p>
        <button type="button" className="btn btn-ghost" onClick={() => reload(true)}>{t('common.retry')}</button>
      </div>
    );
  } else if (lyrics) {
    body = (
      <div className="tft-lyrics-stage-msg">
        <p>{t('stage.not_found')}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasting(true)}>{t('stage.paste')}</button>
      </div>
    );
  }

  const fsMessage = status === 'loading' ? t('stage.loading')
    : lyrics?.marked_wrong ? t('stage.marked_wrong_short')
    : lyrics?.instrumental ? t('stage.instrumental')
    : lyrics?.error ? lrclibProblem(lyrics.error)
    : t('stage.not_found_short');

  return (
    <div className="tft-lyrics-stage">
      <div className="tft-lyrics-stage-head">
        <span className="tft-eyebrow">{t('stage.title')}</span>
        {found && <span className="tft-pill">{t(`stage.source_${lyrics.source}`, lyrics.source)}</span>}
        {found && !lyrics.synced && <span className="tft-pill amber">{t('stage.not_synced')}</span>}

        <div className="tft-lyrics-stage-actions">
          {found && lyrics.synced && (
            <div className="tft-offset" role="group" aria-label={t('stage.offset_label')}>
              <button type="button" className="tft-offset-btn" onClick={() => changeOffset(offsetMs - OFFSET_STEP_MS)} title={t('stage.offset_earlier')} aria-label={t('stage.offset_earlier')}>−</button>
              <button type="button" className="tft-offset-val tft-mono" onClick={() => offsetMs && changeOffset(0)} title={t('stage.offset_reset')} disabled={!offsetMs}>
                {offsetMs > 0 ? '+' : ''}{(offsetMs / 1000).toFixed(1)}s
              </button>
              <button type="button" className="tft-offset-btn" onClick={() => changeOffset(offsetMs + OFFSET_STEP_MS)} title={t('stage.offset_later')} aria-label={t('stage.offset_later')}>+</button>
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => { setQueueOpen(v => !v); setVersionsOpen(false); }}
            aria-expanded={queueOpen}
          >
            {t('queue.toggle')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => { setVersionsOpen(v => !v); setQueueOpen(false); }}
            aria-expanded={versionsOpen}
          >
            {t('stage.versions')}
          </button>
          {found && !editing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              {lyrics.synced ? t('editor.edit_timing') : t('editor.sync_lyrics')}
            </button>
          )}
          {found && !editing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleWrong(true)} title={t('stage.wrong_title')}>
              {t('stage.wrong')}
            </button>
          )}
          {found && <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopy}>{t('stage.copy')}</button>}
          {found && <button type="button" className="btn btn-ghost btn-sm" onClick={handleDownload}>{t('stage.download')}</button>}
          {canSave && (
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? t('stage.saving') : t('stage.save_to_file')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFullscreen(true)} title={`${t('stage.fullscreen')} (F)`}>
            {t('stage.fullscreen')}
          </button>
          <a className="btn btn-ghost btn-sm" href={qrPageUrl()} target="_blank" rel="noreferrer" title={t('app.phone_qr')}>
            {t('stage.on_tv')}
          </a>
        </div>
      </div>

      {notice && (
        <p className={`tft-lyrics-stage-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>
      )}

      {queueOpen && (
        <UpNext
          np={np}
          trackKey={trackKey}
          onError={(msg) => flash('error', t('queue.play_failed', { msg }))}
        />
      )}

      {versionsOpen && (
        <VersionPicker
          np={np}
          currentId={lyrics?.lrclib_id ?? null}
          onChoose={async (id) => {
            try {
              await choose(id);
              setVersionsOpen(false);
            } catch (err) {
              flash('error', t('stage.choose_failed', { msg: err.message }));
            }
          }}
        />
      )}

      <div className="tft-lyrics-stage-body">
        {editing && found ? (
          <LrcEditor
            np={np}
            text={lyrics.text}
            offsetMs={offsetMs}
            onSeek={onSeek}
            onCancel={() => setEditing(false)}
            onSave={async (lrc) => {
              await saveCustom(lrc);
              setEditing(false);
              flash('ok', canSaveAfterEdit ? t('editor.saved_file_hint') : t('editor.saved'));
            }}
          />
        ) : body}
      </div>

      {found && lyrics.synced && canSeek && <p className="tft-lyrics-stage-tip">{t('stage.tip_click_line')}</p>}

      {!libraryConfigured && !hintDismissed && (
        <div className="tft-lyrics-stage-hint">
          <span>{t('stage.library_hint')}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenSettings}>{t('stage.library_hint_open')}</button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={t('stage.dismiss')}
            onClick={() => {
              setHintDismissed(true);
              try { localStorage.setItem(HINT_DISMISSED_KEY, '1'); } catch { /* blocked */ }
            }}
          >✕</button>
        </div>
      )}

      {fullscreen && (
        <LyricsFullscreen
          np={np}
          lyrics={lyrics}
          message={fsMessage}
          onSeekLine={seekLine}
          onControl={onControl}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
}

const PREFETCH_SETTLE_MS = 4000;

const QUEUE_PILLS = {
  synced: { cls: 'tft-pill signal', key: 'stage.synced' },
  plain: { cls: 'tft-pill', key: 'stage.not_synced' },
  instrumental: { cls: 'tft-pill', key: 'stage.instrumental_short' },
  none: { cls: 'tft-pill', key: 'queue.no_lyrics' },
};

/**
 * The tracks after the playing one in the zone's Roon queue, with what is known of their
 * lyrics (the backend looks the next ones up in advance). A click plays from that track.
 * Re-read at each track change.
 */
function UpNext({ np, trackKey, onError }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [playing, setPlaying] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`/api/roon/queue?zone_id=${encodeURIComponent(np.zone_id)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (!data.success) throw new Error(data.error?.message || 'error');
        // Roon lists the playing track first.
        const all = data.items || [];
        const idx = all.findIndex(i => i.title === np.title && i.artist === np.artist);
        setErr(null);
        setItems(all.slice(idx >= 0 ? idx + 1 : 1));
      })
      .catch(e => { if (!cancelled) { setErr(e.message); setItems(null); } });
    load();
    // The lookahead takes a few seconds after a track change: read the markers again once.
    const again = setTimeout(load, PREFETCH_SETTLE_MS);
    return () => { cancelled = true; clearTimeout(again); };
  }, [trackKey]);

  async function play(item) {
    setPlaying(item.queue_item_id);
    try {
      const res = await fetch('/api/roon/queue/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: np.zone_id, queue_item_id: item.queue_item_id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || `HTTP ${res.status}`);
    } catch (e) {
      onError(e.message);
    } finally {
      setPlaying(null);
    }
  }

  return (
    <div className="tft-versions tft-queue">
      <p className="muted small">{t('queue.hint')}</p>
      {err && <p className="tft-lyrics-stage-notice error" role="alert">{t('queue.load_failed', { msg: err })}</p>}
      {items && items.length === 0 && <p className="muted small">{t('queue.empty')}</p>}
      {items && items.length > 0 && (
        <ul className="tft-versions-list">
          {items.map(item => {
            const pill = QUEUE_PILLS[item.lyrics];
            return (
              <li key={item.queue_item_id}>
                <button
                  type="button"
                  className="tft-version"
                  onClick={() => play(item)}
                  disabled={playing != null}
                  title={t('queue.play_tip')}
                >
                  {item.image_key
                    ? <img className="tft-queue-cover" src={`/api/roon/image/${item.image_key}?w=40&h=40`} alt="" loading="lazy" />
                    : <span className="tft-queue-cover" aria-hidden="true" />}
                  <span className="tft-version-name">{item.title}{item.artist ? ` — ${item.artist}` : ''}</span>
                  {pill
                    ? <span className={pill.cls}>{t(pill.key)}</span>
                    : <span className="tft-pill" title={t('queue.unknown')} aria-label={t('queue.unknown')}>…</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Type or paste this track's lyrics (plain text or LRC) — for a song LRCLIB lacks or has wrong.
 * Saved like the LRC editor's result: in the local cache, then "Sync" can add the timing.
 */
function PasteLyrics({ onSave, onCancel }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  async function save() {
    setSaving(true);
    setErr(null);
    try { await onSave(text.trim()); } catch (e) { setErr(e.message); setSaving(false); }
  }
  return (
    <div className="tft-paste">
      <textarea
        className="tft-paste-text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t('stage.paste_placeholder')}
        aria-label={t('stage.paste')}
        rows={10}
        autoFocus
      />
      {err && <p className="tft-lyrics-stage-notice error" role="alert">{err}</p>}
      <div className="tft-paste-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || !text.trim()}>
          {saving ? t('stage.saving') : t('stage.paste_save')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

/**
 * Search LRCLIB by (editable) title and artist and pick a version.
 */
function VersionPicker({ np, currentId, onChoose }) {
  const { t } = useTranslation();
  // Same simplification as the backend's second LRCLIB try: Roon titles carry
  // "(Remastered 2011)"-style suffixes and join several artists with " / ".
  const [title, setTitle] = useState(() => (np.title || '').replace(/\s*[([][^)\]]*[)\]]/g, '').trim() || np.title || '');
  const [artist, setArtist] = useState(() => (np.artist || '').split(/\s+\/\s+/)[0]);
  const [hits, setHits] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [choosing, setChoosing] = useState(null);

  async function search(e) {
    e?.preventDefault();
    if (!title.trim() || !artist.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ title: title.trim(), artist: artist.trim() });
      // The playing track, so the list comes best fit first (same order as the automatic choice).
      if (np.album) qs.set('album', np.album);
      if (np.duration_seconds) qs.set('duration', String(Math.round(np.duration_seconds)));
      const res = await fetch(`/api/lrclib/search?${qs.toString()}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setHits(data.hits || []);
    } catch (e2) {
      setErr(e2.message);
      setHits(null);
    } finally {
      setLoading(false);
    }
  }

  // Search once with the track's own metadata when the picker opens.
  useEffect(() => { search(); }, []);

  return (
    <div className="tft-versions">
      <form className="tft-versions-form" onSubmit={search}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('stage.search_title')} aria-label={t('stage.search_title')} />
        <input value={artist} onChange={e => setArtist(e.target.value)} placeholder={t('stage.search_artist')} aria-label={t('stage.search_artist')} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>{loading ? t('common.loading') : t('stage.search')}</button>
      </form>
      {err && <p className="tft-lyrics-stage-notice error" role="alert">{lrclibProblem(err)}</p>}
      {hits && hits.length === 0 && <p className="muted small">{t('stage.no_versions')}</p>}
      {hits && hits.length > 0 && (
        <ul className="tft-versions-list">
          {hits.map(h => (
            <li key={h.id}>
              <button
                type="button"
                className={`tft-version${h.id === currentId ? ' selected' : ''}`}
                onClick={async () => { setChoosing(h.id); await onChoose(h.id); setChoosing(null); }}
                disabled={choosing != null}
              >
                <span className="tft-version-name">{h.trackName} — {h.artistName}</span>
                {h.albumName && <span className="tft-version-album">{h.albumName}</span>}
                {h.duration ? (
                  <span
                    className={`tft-version-length tft-mono${isOtherLength(h.duration, np.duration_seconds) ? ' off' : ''}`}
                    title={isOtherLength(h.duration, np.duration_seconds) ? t('stage.other_length') : undefined}
                  >
                    {formatLength(h.duration)}
                  </span>
                ) : null}
                <span className={`tft-pill${h.hasSynced ? ' signal' : ''}`}>
                  {h.instrumental ? t('stage.instrumental_short') : h.hasSynced ? t('stage.synced') : t('stage.not_synced')}
                </span>
                {h.damaged && <span className="tft-pill amber" title={t('stage.damaged_title')}>{t('stage.damaged')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
