import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import SyncedLyrics from './SyncedLyrics.jsx';
import LyricsFullscreen from './LyricsFullscreen.jsx';
import LrcEditor from './LrcEditor.jsx';
import { useTrackLyrics } from '../hooks/useTrackLyrics.js';
import { shiftLrc } from '../lib/lrc.js';
import { describeError, lrclibProblem } from '../lib/errors.js';
import { isPrivacyMode } from '../lib/privacy.js';

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
  const { status, data, error, reload, setOffset, choose, saveCustom } = useTrackLyrics(np, { path, refreshKey });
  const lyrics = data?.lyrics || null;

  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'ok'|'error', text }
  const [saving, setSaving] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(readDismissed);

  // New track: close the versions picker and clear notices.
  const trackKey = np ? `${np.zone_id}|${np.title}|${np.artist}|${np.album}` : '';
  useEffect(() => { setVersionsOpen(false); setNotice(null); setEditing(false); }, [trackKey]);

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
        <p title={lyrics.error}>{lrclibProblem(lyrics.error)}</p>
        <button type="button" className="btn btn-ghost" onClick={() => reload(true)}>{t('common.retry')}</button>
      </div>
    );
  } else if (lyrics) {
    body = <p className="tft-lyrics-stage-msg">{t('stage.not_found')}</p>;
  }

  const fsMessage = status === 'loading' ? t('stage.loading')
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVersionsOpen(v => !v)} aria-expanded={versionsOpen}>
            {t('stage.versions')}
          </button>
          {found && !editing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              {lyrics.synced ? t('editor.edit_timing') : t('editor.sync_lyrics')}
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
          <a className="btn btn-ghost btn-sm" href={isPrivacyMode() ? '/api/qr?privacy=1' : '/api/qr'} target="_blank" rel="noreferrer" title={t('app.phone_qr')}>
            {t('stage.on_tv')}
          </a>
        </div>
      </div>

      {notice && (
        <p className={`tft-lyrics-stage-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>
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
                <span className={`tft-pill${h.hasSynced ? ' signal' : ''}`}>
                  {h.instrumental ? t('stage.instrumental_short') : h.hasSynced ? t('stage.synced') : t('stage.not_synced')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
