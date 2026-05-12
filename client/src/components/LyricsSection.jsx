import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import SyncedLyrics from './SyncedLyrics.jsx';
import { useCollapsed } from '../hooks/useCollapsed.js';

function EqSpinner() {
  return (
    <span className="tft-eq" aria-hidden="true">
      <svg width="18" height="14" viewBox="0 0 18 14" xmlns="http://www.w3.org/2000/svg">
        <rect x="0"  y="5" width="3" height="9" rx="1"/>
        <rect x="4"  y="2" width="3" height="12" rx="1"/>
        <rect x="8"  y="0" width="3" height="14" rx="1"/>
        <rect x="12" y="2" width="3" height="12" rx="1"/>
        <rect x="16" y="5" width="3" height="9" rx="1"/>
      </svg>
    </span>
  );
}

// 25-second countdown before silently discarding unsaved lyrics on track change.
// User can short-circuit via "Save" (transfers + then applies), "Discard"
// (applies immediately without saving), or "Stay" (cancels the re-sync and
// keeps the current work environment intact).
const UNSAVED_COUNTDOWN_SECONDS = 25;

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
  autoSync = true,
  onAutoSyncChange,
}) {
  const { t } = useTranslation();
  const np = nowPlaying;

  // ── LRCLIB state ────────────────────────────────────────────────────────────
  const [lrclibStatus, setLrclibStatus] = useState('idle'); // idle|checking|found|instrumental|not_found|error
  const [lrclibResult, setLrclibResult] = useState(null);   // { synced, plain, source, trackName, artistName, albumName }
  const [lrclibHits, setLrclibHits] = useState(null);       // array of all search hits, or null
  const [lrclibHitIdx, setLrclibHitIdx] = useState(0);      // currently selected hit index
  const [lrclibLoadingVersions, setLrclibLoadingVersions] = useState(false);
  const [lrclibOpen, setLrclibOpen] = useState(true);
  const [lrclibError, setLrclibError] = useState(null);
  const [lrclibTransfer, setLrclibTransfer] = useState('idle'); // idle|checking|confirm|saving|saved|error

  // ── TFT state ───────────────────────────────────────────────────────────────
  const [force, setForce] = useState(false);
  const [tftOptions, setTftOptions] = useState({ audioType: 'auto', timestamps: 'auto', language: '', vintage: false });
  const [optionsCollapsed, toggleOptionsCollapsed] = useCollapsed('tft-options', true);
  const [showTftHelp, setShowTftHelp] = useState(false);
  const [tftGenerating, setTftGenerating] = useState(false);
  const [tftJob, setTftJob] = useState(null);   // { job_id, status, lrc_file, lyrics_embedded, error }
  const [tftOpen, setTftOpen] = useState(true);
  const [tftLyrics, setTftLyrics] = useState(null); // fetched after job done
  const [tftTransfer, setTftTransfer] = useState('idle'); // idle|checking|confirm|saving|saved|error
  const [tftGenError, setTftGenError] = useState(null);
  const pollingRef = useRef(null);

  // ── File metadata for search (decoupled from Roon nowPlaying) ──────────────
  // When Auto Sync is OFF and the player moves to another track, nowPlaying
  // updates live but effectivePath stays frozen on the matched file.
  // We fetch the matched file's own tags so that LRCLIB/TFT searches always
  // target the right track, not whatever is currently playing in Roon.
  const [fileSearchMeta, setFileSearchMeta] = useState(null);
  useEffect(() => {
    if (!effectivePath) { setFileSearchMeta(null); return; }
    let cancelled = false;
    fetch(`/api/music/file-tags?path=${encodeURIComponent(effectivePath)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        if (d?.success) {
          setFileSearchMeta({
            title:            d.tags.title            || null,
            artist:           d.tags.artist           || null,
            album:            d.tags.album            || null,
            duration_seconds: d.format.duration_seconds || null,
          });
        } else {
          setFileSearchMeta(null);
        }
      })
      .catch(() => { if (!cancelled) setFileSearchMeta(null); });
    return () => { cancelled = true; };
  }, [effectivePath]);

  // Prefer file tags over Roon nowPlaying for search queries
  const searchTitle    = fileSearchMeta?.title            || np?.title;
  const searchArtist   = fileSearchMeta?.artist           || np?.artist;
  const searchAlbum    = fileSearchMeta?.album            || np?.album;
  const searchDuration = fileSearchMeta?.duration_seconds || np?.duration_seconds;

  // ── Track-change / Auto Sync handling ────────────────────────────────────────
  //
  // Auto Sync (controlled by a checkbox in HeroCard, passed as `autoSync` prop):
  //
  //   ON  — panels reset immediately on every track change (no dialog).
  //         Entering edit mode (LRCLIB check or TFT generate) automatically
  //         turns Auto Sync OFF so the user can work undisturbed.
  //
  //   OFF — panels are frozen; track changes are ignored.
  //         When the user manually re-enables Auto Sync:
  //           • unsaved lyrics present → show the save/discard dialog with countdown
  //           • no unsaved lyrics      → reset panels immediately if track changed
  const trackKey = (np?.title ?? '') + '|' + (np?.duration_seconds ?? '');
  const lastAppliedTrackKey = useRef(trackKey);
  const prevAutoSyncRef = useRef(autoSync);
  const [pendingTrackKey, setPendingTrackKey] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [savingOnSwitch, setSavingOnSwitch] = useState(false);
  // Frozen path at dialog-open time — effectivePath may change to the new
  // track while the dialog is displayed, so we must save to the old one.
  const frozenPathRef = useRef(null);

  function applyReset() {
    setLrclibStatus('idle');
    setLrclibResult(null);
    setLrclibHits(null);
    setLrclibHitIdx(0);
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

  // Detect track change — only act when Auto Sync is on
  useEffect(() => {
    if (trackKey === lastAppliedTrackKey.current) return;
    if (!np?.title) return;
    if (!autoSync) return; // Auto Sync off — keep panels as-is
    applyReset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  // When Auto Sync is re-enabled: check for unsaved lyrics before syncing
  useEffect(() => {
    const wasOff = !prevAutoSyncRef.current;
    prevAutoSyncRef.current = autoSync;
    if (!autoSync || !wasOff) return;
    // Just toggled ON
    const lrclibContent = lrclibResult?.synced || lrclibResult?.plain || '';
    const tftContent = tftLyrics || '';
    const lrclibUnsaved = lrclibStatus === 'found' && !!lrclibContent && lrclibTransfer !== 'saved';
    const tftUnsaved   = tftJob?.status === 'done' && !!tftContent   && tftTransfer   !== 'saved';
    if (lrclibUnsaved || tftUnsaved) {
      // Freeze the working path before effectivePath can update to the new track
      frozenPathRef.current = effectivePath;
      // Show save/discard/stay dialog
      setPendingTrackKey(trackKey);
      setCountdown(UNSAVED_COUNTDOWN_SECONDS);
    } else if (trackKey !== lastAppliedTrackKey.current) {
      // Track changed while auto sync was off — reset now
      applyReset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync]);

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
    // Use the path that was active when the dialog opened, NOT the current
    // effectivePath which may already point to the new playing track.
    const savePath = frozenPathRef.current;
    const lrclibContent = lrclibResult?.synced || lrclibResult?.plain || '';
    if (lrclibStatus === 'found' && lrclibContent && lrclibTransfer !== 'saved') {
      try { await doLrclibTransfer(lrclibContent, setLrclibTransfer, savePath); } catch { /* swallow, still proceed */ }
    }
    if (tftJob?.status === 'done' && tftLyrics && tftTransfer !== 'saved') {
      try { await doTransfer(tftLyrics, setTftTransfer, savePath); } catch { /* swallow */ }
    }
    applyReset();
  }

  function handleSwitchDiscard() { applyReset(); }

  // "Stay" — cancel the auto-sync re-enable, keep panels as-is
  function handleSwitchStay() {
    setPendingTrackKey(null);
    setCountdown(0);
    onAutoSyncChange?.(false);
  }

  useEffect(() => () => clearInterval(pollingRef.current), []);

  // ── TFT: disabled reasons ───────────────────────────────────────────────────
  const tokenConfigured = tftAccount?.token_configured;
  const tokenValid = tftAccount?.token_valid !== false; // true if unknown or explicitly true
  const spendable = tftAccount?.credit_available ?? tftAccount?.credit_balance ?? 1;
  const hasCredits = !tokenConfigured || spendable > 0;
  const isLowConfidence = matchConfidence === 'low';
  const [lowConfirmOverride, setLowConfirmOverride] = useState(false);

  // Reset override when track or matched path changes
  useEffect(() => { setLowConfirmOverride(false); }, [effectivePath]);

  let tftDisabledReason = null;
  if (!effectivePath)                                    tftDisabledReason = t('match.no_match');
  else if (!tokenConfigured)                             tftDisabledReason = t('tft.no_token');
  else if (!tokenValid)                                  tftDisabledReason = t('tft.invalid_token');
  else if (!hasCredits)                                  tftDisabledReason = t('tft.no_credits');
  else if (isLowConfidence && !lowConfirmOverride)       tftDisabledReason = t('tft.low_confidence_confirm_required');
  else if (lyricsExist && !force)                        tftDisabledReason = t('tft.lyrics_exist');

  // ── LRCLIB: check ──────────────────────────────────────────────────────────
  async function handleLrclibCheck() {
    onAutoSyncChange?.(false);
    if (!searchTitle || !searchArtist) return;
    setLrclibStatus('checking');
    setLrclibResult(null);
    setLrclibHits(null);
    setLrclibHitIdx(0);
    setLrclibError(null);
    setLrclibTransfer('idle');
    setLrclibOpen(true);
    try {
      const params = new URLSearchParams({ title: searchTitle, artist: searchArtist });
      if (searchAlbum)    params.set('album', searchAlbum);
      if (searchDuration) params.set('duration', String(Math.round(searchDuration)));
      if (effectivePath)  params.set('path', effectivePath);
      const res = await fetch(`/api/lrclib/lookup?${params.toString()}`);
      const data = await res.json();
      if (!data.success && data.error) { setLrclibStatus('error'); setLrclibError(data.error); return; }
      if (!data.found)      { setLrclibStatus('not_found'); return; }
      if (data.instrumental) { setLrclibStatus('instrumental'); return; }
      setLrclibResult(data);
      setLrclibHits(data.hits || null);
      setLrclibHitIdx(data.selectedHitIndex ?? 0);
      setLrclibStatus('found');
    } catch (err) {
      setLrclibStatus('error');
      setLrclibError({ code: 'NETWORK_ERROR', message: err.message });
    }
  }
  // ── LRCLIB: load alternative versions on demand ────────────────────────────
  async function handleLoadMoreVersions() {
    if (!searchTitle || !searchArtist || lrclibLoadingVersions) return;
    setLrclibLoadingVersions(true);
    try {
      const params = new URLSearchParams({ title: searchTitle, artist: searchArtist });
      const res = await fetch(`/api/lrclib/search?${params.toString()}`);
      const data = await res.json();
      const hits = data.hits || [];
      if (hits.length === 0) { setLrclibLoadingVersions(false); return; }
      setLrclibHits(hits);
      // Try to keep the current result selected in the new list
      const currentId = lrclibResult?.id;
      const matchIdx = currentId != null ? hits.findIndex(h => h.id === currentId) : -1;
      setLrclibHitIdx(matchIdx >= 0 ? matchIdx : 0);
    } catch { /* ignore */ } finally {
      setLrclibLoadingVersions(false);
    }
  }
  // ── LRCLIB: hit selection ──────────────────────────────────────────────────
  async function handleHitSelect(idx) {
    if (!lrclibHits || !lrclibHits[idx]) return;
    const hit = lrclibHits[idx];
    setLrclibHitIdx(idx);
    setLrclibTransfer('idle');
    // Hits contain only metadata; fetch lyrics on demand via the hit id.
    try {
      const res = await fetch(`/api/lrclib/hit/${hit.id}`);
      const data = await res.json();
      if (data.found) {
        setLrclibResult(data);
      } else {
        // Fallback: show hit metadata with no lyrics
        setLrclibResult({
          found: true, source: 'search',
          synced: null, plain: null, instrumental: hit.instrumental,
          trackName: hit.trackName, artistName: hit.artistName, albumName: hit.albumName,
        });
      }
    } catch {
      // Network error: keep previous result
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
    onAutoSyncChange?.(false);
    setTftGenError(null);
    setTftJob(null);
    setTftLyrics(null);
    setTftTransfer('idle');
    setTftGenerating(true);
    setTftOpen(true);
    try {
      const body = { force };
      // Always pass the matched file path so the server targets the frozen/selected file,
      // not whatever Roon is currently playing (important when Auto Sync is OFF).
      if (effectivePath) body.confirmed_path = effectivePath;
      if (tftOptions.language.trim()) body.language = tftOptions.language.trim();
      if (tftOptions.audioType && tftOptions.audioType !== 'auto') body.audio_type = tftOptions.audioType;
      if (tftOptions.timestamps) body.timestamps = tftOptions.timestamps;
      if (tftOptions.vintage) body.vintage = true;
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

  async function doTransfer(lrcContent, setTransfer, pathOverride) {
    setTransfer('saving');
    const targetPath = pathOverride || effectivePath;
    try {
      const res = await fetch('/api/music/file-lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, lrc_content: lrcContent, embed: true }),
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
  async function doLrclibTransfer(lrcContent, setTransfer, pathOverride) {
    setTransfer('saving');
    const targetPath = pathOverride || effectivePath;
    try {
      const res = await fetch('/api/lrclib/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetPath,
          lrc_content: lrcContent,
          embed: true,
          title: searchTitle || undefined,
          artist: searchArtist || undefined,
          album: searchAlbum || undefined,
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
      return <span className="tft-lyrics-badge tft-lyrics-badge--err" title={lrclibError?.message}>{t('lyrics.lrclib_error')}</span>;
    return null;
  }

  function TftBadge() {
    if (!tftJob && tftGenerating)
      return <span className="tft-lyrics-badge tft-lyrics-badge--info"><EqSpinner />{t('tft.progress_processing')}</span>;
    if (tftJob?.status === 'done')
      return <span className="tft-lyrics-badge tft-lyrics-badge--ok">{t('lyrics.tft_done')}</span>;
    if (tftJob?.status === 'error')
      return <span className="tft-lyrics-badge tft-lyrics-badge--err">{t('lyrics.tft_error')}</span>;
    if (tftJob && tftGenerating) {
      const phase = tftJob.phase;
      const label = phase === 'separating_vocals' ? t('tft.phase_separating')
        : phase === 'transcribing'              ? t('tft.phase_transcribing')
        : phase === 'retrying_with_separation'  ? t('tft.phase_retrying')
        : t('tft.progress_processing');
      return <span className="tft-lyrics-badge tft-lyrics-badge--info"><EqSpinner />{label}</span>;
    }
    return null;
  }

  function TftProcessingDetail() {
    if (!tftGenerating) return null;
    const phase = tftJob?.phase;
    const pct   = tftJob?.demucs_progress ?? 0;
    const phaseStartedAt = tftJob?.phase_started_at;

    // Elapsed timer for the current phase
    const [elapsed, setElapsed] = useState(() => {
      if (!phaseStartedAt) return 0;
      return Math.floor((Date.now() - new Date(phaseStartedAt).getTime()) / 1000);
    });
    useEffect(() => {
      if (!phaseStartedAt) return;
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - new Date(phaseStartedAt).getTime()) / 1000));
      }, 1000);
      return () => clearInterval(id);
    }, [phaseStartedAt]);

    const elapsedLabel = elapsed >= 60
      ? `${Math.floor(elapsed / 60)} min ${elapsed % 60} s`
      : t('tft.elapsed', { s: elapsed });

    if (phase === 'separating_vocals') {
      return (
        <div className="tft-phase-detail-block">
          <span className="tft-phase-detail">
            {t('tft.phase_separating')} {t('tft.phase_separating_detail', { pct })}
          </span>
          <div className="tft-phase-bar-track">
            <div className="tft-phase-bar" style={{ width: `${pct}%` }} />
          </div>
          {phaseStartedAt && <span className="tft-elapsed">{elapsedLabel}</span>}
        </div>
      );
    }
    if (phase === 'transcribing')
      return (
        <div className="tft-phase-detail-block">
          <p className="tft-lyrics-no-preview">{t('tft.phase_transcribing')}</p>
          {phaseStartedAt && <span className="tft-elapsed">{elapsedLabel}</span>}
        </div>
      );
    if (phase === 'retrying_with_separation')
      return (
        <div className="tft-phase-detail-block">
          <p className="tft-lyrics-no-preview">{t('tft.phase_retrying')}</p>
          {phaseStartedAt && <span className="tft-elapsed">{elapsedLabel}</span>}
        </div>
      );
    return <p className="tft-lyrics-no-preview">{t('tft.progress_processing')}</p>;
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
          {lrclibStatus === 'checking'
            ? <><EqSpinner />{t('lyrics.lrclib_checking')}</>
            : t('lyrics.lrclib_button')}
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
          {tftGenerating
            ? <><EqSpinner />{t('lyrics.tft_generating')}</>
            : t('lyrics.tft_button')}
        </button>
        <TftBadge />

      </div>

      {/* ── TFT advanced options (compact) ───────────────────────────────────── */}
      {!tftGenerating && !tftJob && tokenConfigured && tokenValid && hasCredits && effectivePath && (
        <div className="tft-options-block" style={{ marginTop: 6 }}>
          <div className="tft-options-header tft-options-header--collapsible" onClick={toggleOptionsCollapsed}>
            <span className="tft-options-chevron">{optionsCollapsed ? '▶' : '▼'}</span>
            {t('tft.options_title')}
            <button
              className="tft-options-help-btn"
              type="button"
              onClick={e => { e.stopPropagation(); setShowTftHelp(true); }}
              title={t('tft.options_help_label')}
            >ⓘ</button>
          </div>
          {!optionsCollapsed && (
            <>
              <div className="tft-options-row">
                <span className="tft-options-label">{t('tft.audio_type_label')}</span>
                <div className="tft-options-radios">
                  {['auto', 'speech', 'music'].map(v => (
                    <button key={v} type="button"
                      className={`tft-radio-btn${tftOptions.audioType === v ? ' tft-radio-btn-active' : ''}`}
                      onClick={() => setTftOptions(o => ({ ...o, audioType: v }))}
                    >{t(`tft.audio_type_${v}`)}</button>
                  ))}
                </div>
              </div>
              <div className="tft-options-row">
                <span className="tft-options-label">{t('tft.timestamps_label')}</span>
                <div className="tft-options-radios">
                  {['auto', 'required', 'none'].map(v => (
                    <button key={v} type="button"
                      className={`tft-radio-btn${tftOptions.timestamps === v ? ' tft-radio-btn-active' : ''}`}
                      onClick={() => setTftOptions(o => ({ ...o, timestamps: v }))}
                    >{t(`tft.timestamps_${v}`)}</button>
                  ))}
                </div>
              </div>
              <div className="tft-options-row">
                <label htmlFor="ls-tft-language" className="tft-options-label">{t('tft.language_label')}</label>
                <select
                  id="ls-tft-language"
                  className="tft-options-select"
                  value={tftOptions.language}
                  onChange={e => setTftOptions(o => ({ ...o, language: e.target.value }))}
                >
                  <option value="">{t('tft.language_auto')}</option>
                  <option value="en">en</option>
                  <option value="fr">fr</option>
                  <option value="es">es</option>
                  <option value="de">de</option>
                  <option value="it">it</option>
                  <option value="pt">pt</option>
                  <option value="ja">ja</option>
                  <option value="ko">ko</option>
                  <option value="zh">zh</option>
                  <option value="ar">ar</option>
                  <option value="ru">ru</option>
                </select>
              </div>
              <label className="tft-toggle-label" style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={tftOptions.vintage}
                  onChange={e => setTftOptions(o => ({ ...o, vintage: e.target.checked }))}
                />
                {t('tft.vintage_label')}
              </label>
            </>
          )}
        </div>
      )}

      {/* TFT help modal */}
      {showTftHelp && (
        <div className="tft-help-backdrop" onClick={() => setShowTftHelp(false)}>
          <div className="tft-help-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('tft.help_modal_title')}</h3>
            <dl>
              <div><dt>{t('tft.help_audio_type_title')}</dt><dd>{t('tft.help_audio_type')}</dd></div>
              <div><dt>{t('tft.help_timestamps_title')}</dt><dd>{t('tft.help_timestamps')}</dd></div>
              <div><dt>{t('tft.help_language_title')}</dt><dd>{t('tft.help_language')}</dd></div>
              <div><dt>{t('tft.help_vintage_title')}</dt><dd>{t('tft.help_vintage')}</dd></div>
            </dl>
            <button className="btn btn-secondary tft-help-close" onClick={() => setShowTftHelp(false)}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

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
            {/* "See other versions" button — shown after an exact /api/get match */}
            {!lrclibHits && lrclibStatus === 'found' && (
              <button
                className="btn btn-ghost lrclib-more-versions-btn"
                onClick={handleLoadMoreVersions}
                disabled={lrclibLoadingVersions}
              >
                {lrclibLoadingVersions ? t('lyrics.hits_loading_more') : t('lyrics.hits_load_more')}
              </button>
            )}
            {/* Version picker: shown when search returned multiple results */}
            {lrclibHits && lrclibHits.length > 1 && (
              <div className="lrclib-hits-picker">
                <label htmlFor="lrclib-hit-select" className="tft-options-label">
                  {t('lyrics.hits_picker_label')}
                </label>
                <select
                  id="lrclib-hit-select"
                  className="tft-options-select lrclib-hits-select"
                  value={lrclibHitIdx}
                  onChange={e => handleHitSelect(Number(e.target.value))}
                >
                  {lrclibHits.map((h, i) => {
                    const lrcType = h.hasSynced
                      ? t('lyrics.hit_synced')
                      : h.instrumental
                        ? t('lyrics.instrumental')
                        : t('lyrics.hit_plain');
                    const parts = [
                      h.trackName,
                      h.artistName ? `— ${h.artistName}` : '',
                      h.albumName  ? `· ${h.albumName}`  : '',
                      `(${lrcType})`,
                    ].filter(Boolean);
                    return <option key={i} value={i}>{parts.join(' ')}</option>;
                  })}
                </select>
              </div>
            )}
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
              >
                {t('lyrics.unsaved_discard')}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleSwitchStay}
                disabled={savingOnSwitch}
                autoFocus
              >
                {t('lyrics.unsaved_stay')}
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
            {tftGenerating && <TftProcessingDetail />}
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
