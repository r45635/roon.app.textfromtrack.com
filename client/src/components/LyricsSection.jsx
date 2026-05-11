import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import SyncedLyrics from './SyncedLyrics.jsx';

// 6-second countdown before silently discarding unsaved lyrics on track change.
// User can short-circuit via "Save" (transfers + then applies) or "Discard"
// (applies immediately without saving).
const UNSAVED_COUNTDOWN_SECONDS = 6;

/**
 * LyricsSection — unified lyrics providers section.
 *
 * Displays LRCLIB and TextFromTrack at the same visual level.
 * Each provider produces a foldable result panel with a "Transfer to File Tags" button.
 * Save options (embed, backup, LRC sidecar) are read from user preferences — not shown here.
 *
 * Props:
 *   nowPlaying      — Roon NowPlaying object { title, artist, album, duration_seconds, state }
 *   effectivePath   — absolute path to the matched audio file (may be null)
 *   confirmedPath   — user-selected alternative path (null = auto-match)
 *   lyricsExist     — bool: whether the track already has lyrics
 *   tftAccount      — { token_configured, credit_available, credit_balance }
 *   matchConfidence — 'high' | 'medium' | 'low' | 'none' | null
 *   onTagsRefresh   — callback after a successful transfer (refreshes FileTagsCard)
 */
export default function LyricsSection({
  nowPlaying,
  effectivePath,
  confirmedPath,
  lyricsExist,
  tftAccount,
  matchConfidence,
  onTagsRefresh,
}) {
  const { t } = useTranslation();
  const np = nowPlaying;

  // ── LRCLIB state ────────────────────────────────────────────────────────────
  const [lrclibStatus, setLrclibStatus] = useState('idle'); // idle|checking|found|instrumental|not_found|error
  const [lrclibResult, setLrclibResult] = useState(null);   // { synced, plain, source, trackName, artistName, albumName }
  const [lrclibOpen, setLrclibOpen] = useState(true);
  const [lrclibError, setLrclibError] = useState(null);
  const [lrclibTransfer, setLrclibTransfer] = useState('idle'); // idle|checking|confirm|saving|saved|error

  // ── TFT state ───────────────────────────────────────────────────────────────
  const [force, setForce] = useState(false);
  const [tftGenerating, setTftGenerating] = useState(false);
  const [tftJob, setTftJob] = useState(null);   // { job_id, status, lrc_file, lyrics_embedded, error }
  const [tftOpen, setTftOpen] = useState(true);
  const [tftLyrics, setTftLyrics] = useState(null); // fetched after job done
  const [tftTransfer, setTftTransfer] = useState('idle'); // idle|checking|confirm|saving|saved|error
  const [tftGenError, setTftGenError] = useState(null);
  const pollingRef = useRef(null);

  // ── Track-change handling with unsaved-lyrics countdown ─────────────────────
  //
  // When the Roon track changes, we DON'T immediately wipe the LRCLIB / TFT
  // panels — first we look at whether either source has lyrics displayed that
  // have NOT been transferred to File Tags yet. If so, we hold the current
  // panel state, show a modal with a {{UNSAVED_COUNTDOWN_SECONDS}}-second
  // countdown, and only apply the reset when:
  //   • the user clicks Save  → transfer first, then reset
  //   • the user clicks Discard → reset immediately, no save
  //   • the countdown expires → reset without saving (default = No)
  //
  // The countdown only controls the lyrics display state; it never touches
  // Roon playback or other panels.
  const trackKey = (np?.title ?? '') + '|' + (np?.duration_seconds ?? '');
  const lastAppliedTrackKey = useRef(trackKey);
  const [pendingTrackKey, setPendingTrackKey] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [savingOnSwitch, setSavingOnSwitch] = useState(false);

  function applyReset() {
    setLrclibStatus('idle');
    setLrclibResult(null);
    setLrclibError(null);
    setLrclibTransfer('idle');
    setLrclibOpen(true);
    setTftJob(null);
    setTftLyrics(null);
    setTftTransfer('idle');
    setTftGenError(null);
    setForce(false);
    setPendingTrackKey(null);
    setCountdown(0);
    setSavingOnSwitch(false);
    clearInterval(pollingRef.current);
    lastAppliedTrackKey.current = trackKey;
  }

  // Detect track change
  useEffect(() => {
    if (trackKey === lastAppliedTrackKey.current) return;
    // Ignore transient null/empty states (e.g. polling error momentarily clears nowPlaying)
    if (!np?.title) return;
    // Already in countdown? Update the pending target (latest wins).
    if (pendingTrackKey != null) {
      setPendingTrackKey(trackKey);
      return;
    }

    // Anything potentially unsaved? A source is "unsaved" when it has lyrics
    // content displayed AND was not transferred to File Tags this session.
    const lrclibContent = lrclibResult?.synced || lrclibResult?.plain || '';
    const tftContent = tftLyrics || '';
    const lrclibUnsaved = lrclibStatus === 'found' && !!lrclibContent && lrclibTransfer !== 'saved';
    const tftUnsaved   = tftJob?.status === 'done' && !!tftContent   && tftTransfer   !== 'saved';

    if (!lrclibUnsaved && !tftUnsaved) {
      applyReset();
      return;
    }
    setPendingTrackKey(trackKey);
    setCountdown(UNSAVED_COUNTDOWN_SECONDS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  // Countdown ticker
  useEffect(() => {
    if (pendingTrackKey == null || countdown <= 0) return;
    const id = setTimeout(() => setCountdown(n => n - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, pendingTrackKey]);

  // Countdown expiration → silent discard + apply
  useEffect(() => {
    if (pendingTrackKey == null) return;
    if (countdown > 0) return;
    applyReset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, pendingTrackKey]);

  async function handleSwitchSave() {
    if (savingOnSwitch) return;
    setSavingOnSwitch(true);
    const lrclibContent = lrclibResult?.synced || lrclibResult?.plain || '';
    if (lrclibStatus === 'found' && lrclibContent && lrclibTransfer !== 'saved') {
      try { await doLrclibTransfer(lrclibContent, setLrclibTransfer); } catch { /* swallow, still proceed */ }
    }
    if (tftJob?.status === 'done' && tftLyrics && tftTransfer !== 'saved') {
      try { await doTransfer(tftLyrics, setTftTransfer); } catch { /* swallow */ }
    }
    applyReset();
  }

  function handleSwitchDiscard() { applyReset(); }

  useEffect(() => () => clearInterval(pollingRef.current), []);

  // ── TFT: disabled reasons ───────────────────────────────────────────────────
  const tokenConfigured = tftAccount?.token_configured;
  const spendable = tftAccount?.credit_available ?? tftAccount?.credit_balance ?? 1;
  const hasCredits = !tokenConfigured || spendable > 0;
  const isLowConfidence = matchConfidence === 'low';
  const [lowConfirmOverride, setLowConfirmOverride] = useState(false);

  // Reset override when track or matched path changes
  useEffect(() => { setLowConfirmOverride(false); }, [effectivePath]);

  let tftDisabledReason = null;
  if (!effectivePath)                          tftDisabledReason = t('match.no_match');
  else if (!tokenConfigured)                   tftDisabledReason = t('tft.no_token');
  else if (!hasCredits)                        tftDisabledReason = t('tft.no_credits');
  else if (isLowConfidence && !lowConfirmOverride) tftDisabledReason = t('tft.low_confidence_confirm_required');
  else if (lyricsExist && !force)              tftDisabledReason = t('tft.lyrics_exist');

  // ── LRCLIB: check ──────────────────────────────────────────────────────────
  async function handleLrclibCheck() {
    if (!np?.title || !np?.artist) return;
    setLrclibStatus('checking');
    setLrclibResult(null);
    setLrclibError(null);
    setLrclibTransfer('idle');
    setLrclibOpen(true);
    try {
      const params = new URLSearchParams({ title: np.title, artist: np.artist });
      if (np.album)            params.set('album', np.album);
      if (np.duration_seconds) params.set('duration', String(Math.round(np.duration_seconds)));
      if (effectivePath)       params.set('path', effectivePath);
      const res = await fetch(`/api/lrclib/lookup?${params.toString()}`);
      const data = await res.json();
      if (!data.success && data.error) { setLrclibStatus('error'); setLrclibError(data.error); return; }
      if (!data.found)      { setLrclibStatus('not_found'); return; }
      if (data.instrumental) { setLrclibStatus('instrumental'); return; }
      setLrclibResult(data);
      setLrclibStatus('found');
    } catch (err) {
      setLrclibStatus('error');
      setLrclibError({ code: 'NETWORK_ERROR', message: err.message });
    }
  }

  // ── TFT: polling ───────────────────────────────────────────────────────────
  function fetchTftLyricsPreview() {
    if (!effectivePath) return;
    fetch(`/api/music/file-lyrics?path=${encodeURIComponent(effectivePath)}&include_cache=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.text) setTftLyrics(d.text); })
      .catch(() => {});
  }

  function startPolling(jobId) {
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tft/jobs/${jobId}`);
        const data = await res.json();
        if (!data.success) return;
        setTftJob(data.job);
        if (data.job.status === 'done') {
          clearInterval(pollingRef.current);
          setTftGenerating(false);
          fetchTftLyricsPreview();
        } else if (data.job.status === 'error') {
          clearInterval(pollingRef.current);
          setTftGenerating(false);
        }
      } catch { /* silent */ }
    }, 2000);
  }

  async function handleTftGenerate() {
    setTftGenError(null);
    setTftJob(null);
    setTftLyrics(null);
    setTftTransfer('idle');
    setTftGenerating(true);
    setTftOpen(true);
    try {
      const body = { force };
      if (confirmedPath) body.confirmed_path = confirmedPath;
      // Low-confidence override: pass confirmed_path so server skips the confidence gate
      else if (isLowConfidence && lowConfirmOverride && effectivePath) body.confirmed_path = effectivePath;
      const res = await fetch('/api/tft/generate-current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) { setTftGenError(data.error); setTftGenerating(false); return; }
      if (data.status === 'reused') {
        setTftJob({ job_id: data.job_id, status: 'done', lrc_file: data.lrc_file });
        setTftGenerating(false);
        fetchTftLyricsPreview();
        return;
      }
      setTftJob({ job_id: data.job_id, status: data.status });
      startPolling(data.job_id);
    } catch (err) {
      setTftGenError({ code: 'UNKNOWN_ERROR', message: err.message });
      setTftGenerating(false);
    }
  }

  // ── Transfer to File Tags ──────────────────────────────────────────────────
  async function handleTransfer(lrcContent, setTransfer, doFn) {
    if (!effectivePath || !lrcContent) return;
    setTransfer('checking');
    try {
      const checkRes = await fetch(`/api/music/file-lyrics?path=${encodeURIComponent(effectivePath)}`);
      const checkData = await checkRes.json();
      if (checkData.success && checkData.text) {
        setTransfer('confirm');
        return;
      }
      await (doFn || doTransfer)(lrcContent, setTransfer);
    } catch {
      setTransfer('error');
    }
  }

  async function doTransfer(lrcContent, setTransfer) {
    setTransfer('saving');
    try {
      const res = await fetch('/api/music/file-lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: effectivePath, lrc_content: lrcContent, embed: true }),
      });
      const data = await res.json();
      if (!data.success) { setTransfer('error'); return; }
      setTransfer('saved');
      if (onTagsRefresh) onTagsRefresh();
    } catch {
      setTransfer('error');
    }
  }

  // LRCLIB-specific transfer: writes cache + creates job record + embeds
  async function doLrclibTransfer(lrcContent, setTransfer) {
    setTransfer('saving');
    try {
      const res = await fetch('/api/lrclib/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: effectivePath,
          lrc_content: lrcContent,
          embed: true,
          title: np?.title || undefined,
          artist: np?.artist || undefined,
          album: np?.album || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) { setTransfer('error'); return; }
      setTransfer('saved');
      if (onTagsRefresh) onTagsRefresh();
    } catch {
      setTransfer('error');
    }
  }

  // ── Transfer controls (render helper, not a component) ─────────────────────
  function renderTransfer(lrcContent, transferState, setTransfer, handleFn, doFn) {
    const onHandle = handleFn || ((c, s) => handleTransfer(c, s));
    const onDo     = doFn    || doTransfer;
    if (!effectivePath) {
      return <span className="tft-lyrics-no-match">{t('lyrics.no_match')}</span>;
    }
    if (transferState === 'saved') {
      return <span className="tft-lyrics-transfer-ok">✓ {t('lyrics.transferred')}</span>;
    }
    if (transferState === 'confirm') {
      return (
        <div className="tft-transfer-conflict">
          <span className="tft-transfer-conflict-msg">⚠ {t('lyrics.replace_confirm')}</span>
          <button className="btn btn-secondary tft-transfer-btn"
            onClick={() => onDo(lrcContent, setTransfer)}
          >{t('lyrics.replace_yes')}</button>
          <button className="btn tft-transfer-btn"
            onClick={() => setTransfer('idle')}
          >{t('lyrics.replace_cancel')}</button>
        </div>
      );
    }
    if (transferState === 'error') {
      return (
        <div className="tft-transfer-row">
          <span className="tft-transfer-err">{t('lyrics.transfer_error')}</span>
          <button className="btn btn-secondary tft-transfer-btn"
            onClick={() => setTransfer('idle')}
          >{t('common.retry')}</button>
        </div>
      );
    }
    const busy = transferState === 'checking' || transferState === 'saving';
    return (
      <div className="tft-transfer-row">
        <button
          className="btn btn-primary tft-transfer-btn"
          disabled={busy}
          onClick={() => onHandle(lrcContent, setTransfer)}
        >
          {busy ? t('lyrics.transferring') : t('lyrics.transfer_button')}
        </button>
      </div>
    );
  }

  // ── Badge helpers ───────────────────────────────────────────────────────────
  function LrclibBadge() {
    if (lrclibStatus === 'found' && lrclibResult?.synced)
      return <span className="tft-lyrics-badge tft-lyrics-badge--ok">{t('lyrics.found_synced')}</span>;
    if (lrclibStatus === 'found' && lrclibResult?.plain)
      return <span className="tft-lyrics-badge tft-lyrics-badge--warn">{t('lyrics.found_plain')}</span>;
    if (lrclibStatus === 'instrumental')
      return <span className="tft-lyrics-badge tft-lyrics-badge--info">{t('lyrics.instrumental')}</span>;
    if (lrclibStatus === 'not_found')
      return <span className="tft-lyrics-badge tft-lyrics-badge--miss">{t('lyrics.not_found')}</span>;
    if (lrclibStatus === 'error')
      return <span className="tft-lyrics-badge tft-lyrics-badge--err" title={lrclibError?.message}>{lrclibError?.code || 'Error'}</span>;
    return null;
  }

  function TftBadge() {
    if (!tftJob && tftGenerating)
      return <span className="tft-lyrics-badge tft-lyrics-badge--info">{t('lyrics.tft_processing')}</span>;
    if (tftJob?.status === 'done')
      return <span className="tft-lyrics-badge tft-lyrics-badge--ok">{t('lyrics.tft_done')}</span>;
    if (tftJob?.status === 'error')
      return <span className="tft-lyrics-badge tft-lyrics-badge--err">{t('lyrics.tft_error')}</span>;
    if (tftJob && tftGenerating)
      return <span className="tft-lyrics-badge tft-lyrics-badge--info">{t('lyrics.tft_processing')}</span>;
    return null;
  }

  const lrclibLyrics = lrclibResult?.synced || lrclibResult?.plain || '';

  return (
    <div className="tft-lyrics-section">

      {/* ── Provider buttons row ──────────────────────────────────────────────── */}
      <div className="tft-lyrics-providers">

        {/* LRCLIB */}
        <button
          className="btn btn-secondary tft-lyrics-btn"
          onClick={handleLrclibCheck}
          disabled={!effectivePath || lrclibStatus === 'checking'}
        >
          {lrclibStatus === 'checking' ? t('lyrics.lrclib_checking') : t('lyrics.lrclib_button')}
        </button>
        <LrclibBadge />

        <div className="tft-lyrics-vsep" />

        {/* TextFromTrack — force checkbox: only show when lyrics exist AND it's the only blocking reason */}
        {lyricsExist && effectivePath && tokenConfigured && hasCredits && (!isLowConfidence || lowConfirmOverride) && (
          <label className={`tft-toggle-label tft-lyrics-force${force ? ' warning' : ''}`}>
            <input
              type="checkbox"
              checked={force}
              disabled={tftGenerating}
              onChange={e => setForce(e.target.checked)}
            />
            {t('tft.force_retranscribe')}
          </label>
        )}
        <button
          className="btn btn-secondary tft-lyrics-btn"
          onClick={handleTftGenerate}
          disabled={tftGenerating || !!tftDisabledReason}
          title={tftDisabledReason || undefined}
        >
          {tftGenerating ? t('lyrics.tft_generating') : t('lyrics.tft_button')}
        </button>
        <TftBadge />

      </div>

      {/* ── TFT low-confidence warning ───────────────────────────────────────── */}
      {isLowConfidence && !tftGenerating && !tftJob && (
        <div className={`alert ${lowConfirmOverride ? 'alert-warning' : 'alert-warning'}`} style={{ margin: '4px 0 0', padding: '8px 12px' }}>
          {!lowConfirmOverride && (
            <p style={{ margin: '0 0 6px', fontSize: '0.85em' }}>{t('tft.low_confidence_warning')}</p>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85em', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={lowConfirmOverride}
              onChange={e => setLowConfirmOverride(e.target.checked)}
            />
            {t('tft.low_confidence_confirm')}
          </label>
        </div>
      )}

      {/* ── TFT pre-submit error ─────────────────────────────────────────────── */}
      {tftGenError && !tftJob && (
        <div className="alert alert-error" style={{ margin: 0 }}>
          <strong>[{tftGenError.code}]</strong> {tftGenError.message}
        </div>
      )}

      {/* ── LRCLIB result: foldable ──────────────────────────────────────────── */}
      {lrclibStatus === 'found' && (
        <details
          className="tft-lyrics-result"
          open={lrclibOpen}
          onToggle={e => setLrclibOpen(e.target.open)}
        >
          <summary className="tft-lyrics-result-summary">
            <span className="tft-lyrics-result-source">LRCLIB</span>
            {lrclibResult?.synced
              ? <span className="tft-lyrics-badge tft-lyrics-badge--ok">{t('lyrics.found_synced')}</span>
              : <span className="tft-lyrics-badge tft-lyrics-badge--warn">{t('lyrics.found_plain')}</span>
            }
            {lrclibResult?.source && (
              <span className="tft-lyrics-source-tag">
                {t(`lyrics.source_${lrclibResult.source}`, lrclibResult.source)}
              </span>
            )}
            <span className="tft-lyrics-source-info tft-mono">
              {lrclibResult?.trackName}
              {lrclibResult?.artistName ? ` — ${lrclibResult.artistName}` : ''}
              {lrclibResult?.albumName  ? ` · ${lrclibResult.albumName}`  : ''}
            </span>
          </summary>
          <div className="tft-lyrics-result-body">
            {lrclibLyrics && (
              <SyncedLyrics
                lrcText={lrclibLyrics}
                seekSeconds={np?.seek_position_seconds ?? 0}
                isPlaying={np?.state === 'playing'}
                defaultSync={false}
                compactHeader
              />
            )}
            {renderTransfer(lrclibLyrics, lrclibTransfer, setLrclibTransfer,
              (c, s) => handleTransfer(c, s, doLrclibTransfer),
              doLrclibTransfer
            )}
          </div>
        </details>
      )}

      {/* ── Unsaved-on-track-change countdown modal ───────────────────────────── */}
      {pendingTrackKey != null && (
        <div className="unsaved-modal" role="alertdialog" aria-live="assertive">
          <div className="unsaved-modal-body">
            <div className="unsaved-modal-title">
              ⚠ {t('lyrics.unsaved_title')}
            </div>
            <div className="unsaved-modal-msg">{t('lyrics.unsaved_body')}</div>
            <div className="unsaved-modal-countdown">
              {t('lyrics.unsaved_countdown', { seconds: countdown })}
            </div>
            <div className="unsaved-modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleSwitchSave}
                disabled={savingOnSwitch}
              >
                {savingOnSwitch ? t('lyrics.saving') : t('lyrics.unsaved_save')}
              </button>
              <button
                className="btn"
                onClick={handleSwitchDiscard}
                disabled={savingOnSwitch}
                autoFocus
              >
                {t('lyrics.unsaved_discard')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TFT result: foldable ─────────────────────────────────────────────── */}
      {(tftJob || tftGenerating) && (
        <details
          className="tft-lyrics-result"
          open={tftOpen}
          onToggle={e => setTftOpen(e.target.open)}
        >
          <summary className="tft-lyrics-result-summary">
            <span className="tft-lyrics-result-source">TextFromTrack</span>
            <TftBadge />
          </summary>
          <div className="tft-lyrics-result-body">
            {/* Job in progress */}
            {tftGenerating && !tftJob?.status && (
              <p className="tft-lyrics-no-preview">{t('lyrics.tft_processing')}</p>
            )}
            {/* Error detail */}
            {tftJob?.status === 'error' && tftJob.error && (
              <div className="tft-lyrics-job-error">
                [{tftJob.error.code}] {tftJob.error.message}
              </div>
            )}
            {/* Done with lyrics preview */}
            {tftJob?.status === 'done' && tftLyrics && (
              <SyncedLyrics
                lrcText={tftLyrics}
                seekSeconds={np?.seek_position_seconds ?? 0}
                isPlaying={np?.state === 'playing'}
                defaultSync={false}
                compactHeader
              />
            )}
            {/* Done but nothing saved locally (prefs = no embed, no lrc sidecar) */}
            {tftJob?.status === 'done' && !tftLyrics && (
              <p className="tft-lyrics-no-preview">{t('lyrics.tft_no_preview')}</p>
            )}
            {/* Transfer row — only when lyrics available */}
            {tftJob?.status === 'done' && tftLyrics &&
              renderTransfer(tftLyrics, tftTransfer, setTftTransfer)
            }
            {/* Regenerate link */}
            {tftJob?.status === 'done' && (
              <button
                className="tft-regen-link"
                onClick={() => {
                  setTftJob(null);
                  setTftLyrics(null);
                  setTftTransfer('idle');
                  setForce(true);
                }}
              >
                {t('tft.regenerate_anyway', 'Regénérer quand même…')}
              </button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
