import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const EMBED_SUPPORTED_EXTS = ['.mp3', '.flac'];

/**
 * LrclibPanel — checks LRCLIB for lyrics of the currently playing track,
 * then offers to save / embed them in the matched local file.
 *
 * Props:
 *   nowPlaying   — Roon NowPlaying object  { title, artist, album, duration_seconds }
 *   matchedPath  — absolute path to the matched audio file (may be null)
 *   onSaved      — callback after successful save (to refresh FileTagsCard)
 */
export default function LrclibPanel({ nowPlaying, matchedPath, onSaved }) {
  const { t } = useTranslation();

  // ── State ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState('idle'); // idle | checking | found | instrumental | not_found | error
  const [result, setResult] = useState(null);   // { synced, plain, source, trackName, artistName, albumName }
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState(null);

  // Save options — read defaults from /api/music/config
  const [embed, setEmbed] = useState(false);
  const [backup, setBackup] = useState(true);
  const [saveBeside, setSaveBeside] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [saveError, setSaveError] = useState(null);

  // Load user setting defaults on mount
  useEffect(() => {
    fetch('/api/music/config')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setEmbed(!!d.embed_lyrics_default);
        setBackup(d.backup_before_embed_default !== false);
        setSaveBeside(!!d.save_lrc_beside_source_default);
      })
      .catch(() => {});
  }, []);

  // Reset when track changes
  const trackKey = nowPlaying?.title + '|' + nowPlaying?.artist;
  useEffect(() => {
    setStatus('idle');
    setResult(null);
    setPreviewOpen(false);
    setError(null);
    setSaveStatus('idle');
    setSaveError(null);
  }, [trackKey]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const np = nowPlaying;
  const canCheck = !!(np?.title && np?.artist);
  const canSave = !!matchedPath && (status === 'found');
  const matchedExt = matchedPath ? matchedPath.slice(matchedPath.lastIndexOf('.')).toLowerCase() : '';
  const embedSupported = !matchedPath || EMBED_SUPPORTED_EXTS.includes(matchedExt);
  const lyricsContent = result?.synced || result?.plain || '';

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleCheck() {
    if (!canCheck) return;
    setStatus('checking');
    setResult(null);
    setError(null);
    setSaveStatus('idle');
    setSaveError(null);
    setPreviewOpen(false);
    try {
      const params = new URLSearchParams({ title: np.title, artist: np.artist });
      if (np.album) params.set('album', np.album);
      if (np.duration_seconds) params.set('duration', String(Math.round(np.duration_seconds)));
      const res = await fetch(`/api/lrclib/lookup?${params.toString()}`);
      const data = await res.json();
      if (!data.success && data.error) { setStatus('error'); setError(data.error); return; }
      if (!data.found) { setStatus('not_found'); return; }
      if (data.instrumental) { setStatus('instrumental'); return; }
      setResult(data);
      setStatus('found');
    } catch (err) {
      setStatus('error');
      setError({ code: 'NETWORK_ERROR', message: err.message });
    }
  }

  async function handleSave() {
    if (!matchedPath || !lyricsContent) return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const res = await fetch('/api/lrclib/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: matchedPath,
          lrc_content: lyricsContent,
          embed: embed && embedSupported,
          backup,
          save_beside: saveBeside,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setSaveStatus('error');
        setSaveError(data.error || { message: t('lrclib.save_error') });
        return;
      }
      setSaveStatus('saved');
      if (onSaved) onSaved();
    } catch (err) {
      setSaveStatus('error');
      setSaveError({ message: err.message });
    }
  }

  // ── Status badge ───────────────────────────────────────────────────────────
  function StatusBadge() {
    if (status === 'not_found') return <span className="lrclib-badge lrclib-badge--miss">{t('lrclib.not_found')}</span>;
    if (status === 'instrumental') return <span className="lrclib-badge lrclib-badge--info">{t('lrclib.instrumental')}</span>;
    if (status === 'found' && result?.synced) return <span className="lrclib-badge lrclib-badge--ok">{t('lrclib.found_synced')}</span>;
    if (status === 'found' && result?.plain) return <span className="lrclib-badge lrclib-badge--warn">{t('lrclib.found_plain')}</span>;
    return null;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="lrclib-panel">
      <div className="lrclib-row">
        <button
          className="btn btn-secondary lrclib-check-btn"
          onClick={handleCheck}
          disabled={!canCheck || status === 'checking'}
        >
          {status === 'checking' ? t('lrclib.checking') : t('lrclib.check_button')}
        </button>
        <StatusBadge />
        {status === 'error' && (
          <span className="lrclib-badge lrclib-badge--err" title={error?.message}>
            {error?.code || 'Error'}
          </span>
        )}
      </div>

      {/* Source hint */}
      {status === 'found' && result?.source && (
        <div className="lrclib-source-hint">
          LRCLIB · {result.trackName} — {result.artistName}
          {result.albumName ? ` · ${result.albumName}` : ''}
          <span className="lrclib-source-tag">{t(`lrclib.source_${result.source}`, result.source)}</span>
        </div>
      )}

      {/* Preview toggle */}
      {status === 'found' && lyricsContent && (
        <button
          className="lrclib-preview-toggle"
          onClick={() => setPreviewOpen(o => !o)}
        >
          {previewOpen ? t('lrclib.preview_toggle_hide') : t('lrclib.preview_toggle_show')}
        </button>
      )}

      {previewOpen && lyricsContent && (
        <pre className="lrclib-preview">{lyricsContent.slice(0, 2000)}{lyricsContent.length > 2000 ? '\n…' : ''}</pre>
      )}

      {/* Save section */}
      {status === 'found' && (
        <div className="lrclib-save-section">
          {!matchedPath && (
            <span className="tft-mono lrclib-no-match">{t('lrclib.no_match')}</span>
          )}

          {matchedPath && (
            <>
              <div className="lrclib-toggles">
                <label className="tft-toggle-label">
                  <input type="checkbox" checked={saveBeside} onChange={e => setSaveBeside(e.target.checked)} />
                  {t('lrclib.save_lrc_beside_source')}
                </label>
                {embedSupported && (
                  <label className="tft-toggle-label">
                    <input type="checkbox" checked={embed} onChange={e => setEmbed(e.target.checked)} />
                    {t('lrclib.embed_lyrics')}
                  </label>
                )}
                {embed && embedSupported && (
                  <label className="tft-toggle-label" style={{ paddingLeft: 16 }}>
                    <input type="checkbox" checked={backup} onChange={e => setBackup(e.target.checked)} />
                    {t('lrclib.backup_before_embed')}
                  </label>
                )}
              </div>

              <div className="lrclib-save-row">
                <button
                  className="btn btn-primary"
                  style={{ flexShrink: 0 }}
                  onClick={handleSave}
                  disabled={saveStatus === 'saving' || saveStatus === 'saved' || (!saveBeside && !embed)}
                >
                  {saveStatus === 'saving' ? t('lrclib.saving') : t('lrclib.save_button')}
                </button>

                {saveStatus === 'saved' && (
                  <span className="lrclib-badge lrclib-badge--ok">{t('lrclib.saved_ok')}</span>
                )}
                {saveStatus === 'error' && (
                  <span className="lrclib-badge lrclib-badge--err" title={saveError?.message}>
                    {t('lrclib.save_error')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
