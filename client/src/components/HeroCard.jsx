import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const EMBED_SUPPORTED_EXTS = ['.mp3', '.flac'];

function fmt(seconds) {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ConfidencePill({ confidence }) {
  const { t } = useTranslation();
  const tone = { high: 'signal', medium: 'amber', low: 'error', none: '' }[confidence] || '';
  return (
    <span className={`tft-pill${tone ? ` ${tone}` : ''}`}>
      {tone && <span className="pill-dot" />}
      {t(`match.confidence_${confidence}`, confidence)}
    </span>
  );
}

function LyricsPill({ status }) {
  const { t } = useTranslation();
  const tone = {
    HAS_LRC_FILE: 'signal',
    HAS_EMBEDDED_LYRICS: '',
    NO_LOCAL_LYRICS: 'amber',
    UNKNOWN: '',
  }[status] || '';
  return (
    <span className={`tft-pill${tone ? ` ${tone}` : ''}`}>
      {t(`lyrics_status.${status}`, status)}
    </span>
  );
}

function ScoreChip({ label, points, max }) {
  let cls = 'badge badge-sm badge-neutral';
  if (points > 0 && points >= max) cls = 'badge badge-sm badge-success';
  else if (points > 0) cls = 'badge badge-sm badge-warning';
  return (
    <span className={cls} title={`${label}: ${points}/${max}`}>
      {label} {points}/{max}
    </span>
  );
}

export default function HeroCard({
  nowPlaying,
  matchData,
  tftAccount,
  onControl,
  onVolume,
  onMute,
  onSeek,
  onSettings,
  onGenerated,
}) {
  const { t } = useTranslation();

  // ── Generate state (from TftPanel) ──────────────────────────────────────────
  const [embed, setEmbed] = useState(false);
  const [backup, setBackup] = useState(true);
  const [saveBeside, setSaveBeside] = useState(false);
  const [force, setForce] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [genError, setGenError] = useState(null);
  const pollingRef = useRef(null);

  useEffect(() => () => clearInterval(pollingRef.current), []);

  useEffect(() => {
    fetch('/api/music/config')
      .then(r => r.json())
      .then(d => {
        if (d?.success) {
          setEmbed(!!d.embed_lyrics_default);
          setBackup(d.backup_before_embed_default !== false);
          setSaveBeside(!!d.save_lrc_beside_source_default);
        }
      })
      .catch(() => {});
  }, []);

  function startPolling(jobId) {
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tft/jobs/${jobId}`);
        const data = await res.json();
        if (!data.success) return;
        setActiveJob(data.job);
        if (data.job.status === 'done' || data.job.status === 'error') {
          clearInterval(pollingRef.current);
          setIsGenerating(false);
          if (onGenerated) onGenerated();
        }
      } catch { /* silent */ }
    }, 2000);
  }

  async function handleGenerate() {
    setGenError(null);
    setActiveJob(null);
    setIsGenerating(true);
    try {
      const res = await fetch('/api/tft/generate-current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embed, backup, save_beside: saveBeside, force }),
      });
      const data = await res.json();
      if (!data.success) { setGenError(data.error); setIsGenerating(false); return; }
      if (data.status === 'reused') {
        setActiveJob({ job_id: data.job_id, status: 'done', lrc_file: data.lrc_file });
        setIsGenerating(false);
        if (onGenerated) onGenerated();
        return;
      }
      setActiveJob({ job_id: data.job_id, status: data.status });
      startPolling(data.job_id);
    } catch (err) {
      setGenError({ code: 'UNKNOWN_ERROR', message: err.message });
      setIsGenerating(false);
    }
  }

  // ── Derived values ───────────────────────────────────────────────────────────
  const np = nowPlaying;
  const isPlaying = np?.state === 'playing';
  const progress = np?.duration_seconds
    ? Math.min(100, ((np.seek_position_seconds ?? 0) / np.duration_seconds) * 100)
    : 0;
  const artKey = np?.image_key || (np?.artist_image_keys?.[0] ?? null);

  const match = matchData?.match;
  const lyricsStatus = match?.track?.lyrics_status;
  const lyricsExist = lyricsStatus === 'HAS_LRC_FILE' || lyricsStatus === 'HAS_EMBEDDED_LYRICS';
  const matchedPath = match?.track?.path || '';
  const matchedExt = matchedPath ? matchedPath.slice(matchedPath.lastIndexOf('.')).toLowerCase() : '';
  const embedSupported = !matchedPath || EMBED_SUPPORTED_EXTS.includes(matchedExt);

  const tokenConfigured = tftAccount?.token_configured;
  const spendable = tftAccount?.credit_available ?? tftAccount?.credit_balance ?? 1;
  const hasCredits = !tokenConfigured || spendable > 0;
  const hasHighMatch = match?.matched && (match?.confidence === 'high' || match?.confidence === 'medium');

  let disabledReason = null;
  if (!tokenConfigured) disabledReason = t('tft.no_token');
  else if (!hasCredits) disabledReason = t('tft.no_credits');
  else if (!np || np.state !== 'playing') disabledReason = t('tft.no_track');
  else if (!hasHighMatch) disabledReason = t('tft.no_match');
  else if (lyricsExist && !force) disabledReason = t('tft.lyrics_exist');

  // Volume: use master output or first output
  const firstOutput = np?.outputs?.[0];
  const volumeVal = firstOutput?.volume?.value ?? null;
  const volumeMax = firstOutput?.volume?.soft_limit ?? firstOutput?.volume?.max ?? 100;
  const volumePct = volumeVal != null ? Math.round((volumeVal / volumeMax) * 100) : null;

  const loopLabel = {
    loop: t('now_playing.loop_all'),
    loop_one: t('now_playing.loop_one'),
  }[np?.loop] ?? null;

  const scoreFields = [
    { key: 'title',    label: t('match.detail_title',    'Title') },
    { key: 'artist',   label: t('match.detail_artist',   'Artist') },
    { key: 'album',    label: t('match.detail_album',    'Album') },
    { key: 'duration', label: t('match.detail_duration', 'Dur.') },
    { key: 'filename', label: t('match.detail_filename', 'File') },
    { key: 'isrc',     label: 'ISRC' },
  ];

  return (
    <section className="tft-hero">

      {/* ═══ NOW PLAYING STRIP ══════════════════════════════════════════════════ */}
      <div className="tft-np">
        {/* Album art */}
        {artKey ? (
          <img
            className="tft-album-art"
            src={`/api/roon/image/${artKey}?w=160&h=160`}
            alt=""
            loading="lazy"
          />
        ) : (
          <div className="tft-album-art-placeholder">♫</div>
        )}

        {/* Info column */}
        <div className="tft-np-info">
          <div className="tft-np-pills">
            {np && (
              <span className={`tft-pill${isPlaying ? ' signal' : ''}`}>
                {isPlaying && <span className="pill-dot" />}
                {np.state === 'playing'
                  ? `${t('now_playing.state_playing')} · ${np.zone_name}`
                  : np.state === 'paused'
                  ? t('now_playing.state_paused')
                  : t('now_playing.state_stopped')}
              </span>
            )}
            {np?.auto_radio && <span className="tft-pill">{t('now_playing.auto_radio')}</span>}
            {loopLabel && <span className="tft-pill">↺ {loopLabel}</span>}
            {np?.shuffle && <span className="tft-pill">🔀</span>}
          </div>

          <h1 className="tft-np-title">{np?.title || t('now_playing.no_track')}</h1>
          {np && <>
            <div className="tft-np-artist">{np.artist}</div>
            <div className="tft-np-album tft-mono">{np.album}{np.year ? ` · ${np.year}` : ''}</div>
          </>}

          {/* Progress */}
          {np?.duration_seconds ? (
            <div className="tft-progress-wrap">
              <div
                className={`tft-progress-bar${onSeek && np.is_seek_allowed ? ' np-progress-seekable' : ''}`}
                onClick={onSeek && np.is_seek_allowed ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  onSeek('absolute', Math.round(ratio * np.duration_seconds));
                } : undefined}
              >
                <div className="tft-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="tft-progress-times">
                <span className="t-current">{fmt(np.seek_position_seconds)}</span>
                <span className="t-total">{fmt(np.duration_seconds)}</span>
              </div>
            </div>
          ) : null}

          {/* Controls */}
          {onControl && np && (
            <div className="tft-controls">
              <button
                className="tft-round-btn"
                style={{ width: 32, height: 32, fontSize: 14 }}
                onClick={() => onControl('previous')}
                disabled={!np.is_previous_allowed}
              >⏮</button>
              <button
                className="tft-round-btn primary"
                style={{ width: 44, height: 44, fontSize: 18 }}
                onClick={() => onControl('playpause')}
                disabled={!np.is_play_allowed && !np.is_pause_allowed}
              >{isPlaying ? '⏸' : '▶'}</button>
              <button
                className="tft-round-btn"
                style={{ width: 32, height: 32, fontSize: 14 }}
                onClick={() => onControl('next')}
                disabled={!np.is_next_allowed}
              >⏭</button>

              <div className="tft-ctrl-spacer" />

              {/* Volume */}
              {volumeVal != null && firstOutput && (
                <div className="tft-volume">
                  <span className="tft-volume-icon">🔊</span>
                  <div className="tft-volume-bar">
                    <div className="tft-volume-fill" style={{ width: `${volumePct}%` }} />
                  </div>
                  <div className="tft-volume-val tft-mono">{volumeVal}</div>
                  <button
                    className="tft-round-btn"
                    style={{ width: 26, height: 26, fontSize: 12 }}
                    onClick={() => onVolume?.(firstOutput.output_id, 'relative', -5)}
                  >−</button>
                  <button
                    className="tft-round-btn"
                    style={{ width: 26, height: 26, fontSize: 12 }}
                    onClick={() => onVolume?.(firstOutput.output_id, 'relative', 5)}
                  >+</button>
                </div>
              )}

              {/* Shuffle / Loop */}
              {onSettings && np && (
                <>
                  <button
                    className={`tft-round-btn${np.shuffle ? ' active' : ''}`}
                    style={{ width: 30, height: 30, fontSize: 13 }}
                    onClick={() => onSettings({ shuffle: !np.shuffle })}
                    title={t('now_playing.shuffle')}
                  >🔀</button>
                  <button
                    className={`tft-round-btn${np.loop !== 'disabled' ? ' active' : ''}`}
                    style={{ width: 30, height: 30, fontSize: 13 }}
                    onClick={() => {
                      const next = np.loop === 'disabled' ? 'loop' : np.loop === 'loop' ? 'loop_one' : 'disabled';
                      onSettings({ loop: next });
                    }}
                    title={t('now_playing.loop')}
                  >🔁</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ LOCAL MATCH STRIP ══════════════════════════════════════════════════ */}
      <div className={`tft-match-strip${!match?.matched ? ' no-match' : ''}`}>
        {!match?.matched ? (
          <span className="tft-mono">{t('match.no_match')}</span>
        ) : (
          <div className="tft-match-meta">
            <div className="tft-np-pills">
              <span className="tft-eyebrow" style={{ marginRight: 8 }}>{t('section.local_match', 'Local match')}</span>
              <ConfidencePill confidence={match.confidence} />
              {lyricsStatus && <LyricsPill status={lyricsStatus} />}
              {match.score != null && (
                <span className="tft-pill tft-mono">{match.score} pts</span>
              )}
            </div>
            <div className="tft-match-path">{matchedPath}</div>
            {match.score_detail && (
              <div className="tft-match-chips">
                {scoreFields.map(({ key, label }) => {
                  const d = match.score_detail[key];
                  if (!d) return null;
                  return <ScoreChip key={key} label={label} points={d.points} max={d.max} />;
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ GENERATE STRIP ═════════════════════════════════════════════════════ */}
      {!(activeJob?.status === 'done') && (
      <div className="tft-generate-strip">
        <div className="tft-generate-toggles">
          {lyricsExist && (
            <label className={`tft-toggle-label${force ? ' warning' : ''}`}>
              <input type="checkbox" checked={force} disabled={isGenerating} onChange={e => setForce(e.target.checked)} />
              {t('tft.force_retranscribe')}
            </label>
          )}
          <label className="tft-toggle-label">
            <input type="checkbox" checked={saveBeside} disabled={isGenerating} onChange={e => setSaveBeside(e.target.checked)} />
            {t('tft.save_lrc_beside_source')}
          </label>
          <label className="tft-toggle-label">
            <input type="checkbox" checked={embed && embedSupported} disabled={isGenerating || !embedSupported} onChange={e => setEmbed(e.target.checked)} />
            {t('tft.embed_lyrics')}
          </label>
          {embed && embedSupported && (
            <label className="tft-toggle-label">
              <input type="checkbox" checked={backup} disabled={isGenerating} onChange={e => setBackup(e.target.checked)} />
              {t('tft.backup_before_embed')}
            </label>
          )}
        </div>

        <button
          className="btn btn-primary"
          style={{ flexShrink: 0 }}
          onClick={handleGenerate}
          disabled={isGenerating || !!disabledReason}
        >
          {isGenerating ? t('tft.generating') : t('tft.generate_button')}
        </button>
      </div>
      )}

      {/* Disabled reason — hidden when a job just completed */}
      {disabledReason && !isGenerating && !(activeJob?.status === 'done') && (
        <div style={{ padding: '0 28px 12px' }}>
          <span className="tft-mono" style={{ fontSize: 11, color: 'var(--tft-mute)' }}>{disabledReason}</span>
        </div>
      )}

      {/* Progress box */}
      {activeJob && (
        <div style={{ padding: '0 28px 16px' }}>
          <div className={`progress-box ${activeJob.status === 'error' ? 'progress-error' : activeJob.status === 'done' ? 'progress-done' : 'progress-active'}`}>
            <div className="progress-status">
              {activeJob.status === 'done'   ? t('tft.progress_done') :
               activeJob.status === 'error'  ? t('tft.progress_error') :
               activeJob.status === 'processing' ? t('tft.progress_processing') :
               t('common.loading')}
            </div>
            {activeJob.status === 'done' && activeJob.lrc_file && (
              <div className="progress-detail muted small">{t('tft.lrc_saved')}: {activeJob.lrc_file}</div>
            )}
            {activeJob.status === 'done' && activeJob.lyrics_embedded && (
              <div className="progress-detail embed-success">🏷️ {t('tft.lyrics_embedded_ok')}</div>
            )}
            {activeJob.status === 'done' && (
              <button
                className="tft-regen-link"
                onClick={() => { setActiveJob(null); setForce(true); }}
              >
                {t('tft.regenerate_anyway', 'Regénérer quand même…')}
              </button>
            )}
            {activeJob.status === 'error' && activeJob.error && (
              <div className="progress-detail text-error small">[{activeJob.error.code}] {activeJob.error.message}</div>
            )}
          </div>
        </div>
      )}

      {/* Generate error */}
      {genError && !activeJob && (
        <div style={{ padding: '0 28px 16px' }}>
          <div className="alert alert-error">
            <strong>[{genError.code}]</strong> {genError.message}
          </div>
        </div>
      )}
    </section>
  );
}
