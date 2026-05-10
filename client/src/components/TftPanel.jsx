import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

const PROGRESS_KEYS = {
  pending: 'tft.progress_pending',
  processing: 'tft.progress_processing',
  downloading: 'tft.progress_downloading',
  embedding: 'tft.progress_embedding',
  done: 'tft.progress_done',
  error: 'tft.progress_error',
};

const EMBED_SUPPORTED_EXTS = ['.mp3', '.flac'];

export default function TftPanel({ tftAccount, matchData, nowPlaying, onGenerated }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('tft');

  const [isGenerating, setIsGenerating] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [genError, setGenError] = useState(null);
  const [embed, setEmbed] = useState(false);
  const [backup, setBackup] = useState(true);
  const [force, setForce] = useState(false);
  const pollingRef = useRef(null);

  // Cleanup polling on unmount
  useEffect(() => () => clearInterval(pollingRef.current), []);

  // Load default embed + backup preferences once
  useEffect(() => {
    fetch('/api/music/config')
      .then(r => r.json())
      .then(data => {
        if (data?.success) {
          setEmbed(!!data.embed_lyrics_default);
          setBackup(data.backup_before_embed_default !== false);
        }
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  function startPolling(jobId) {
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tft/jobs/${jobId}`);
        const data = await res.json();
        if (!data.success) return;
        const job = data.job;
        setActiveJob(job);
        if (job.status === 'done' || job.status === 'error') {
          clearInterval(pollingRef.current);
          setIsGenerating(false);
          if (onGenerated) onGenerated();
        }
      } catch {
        // silent — will retry next tick
      }
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
        body: JSON.stringify({ embed, backup, force }),
      });
      const data = await res.json();

      if (!data.success) {
        setGenError(data.error);
        setIsGenerating(false);
        return;
      }

      setActiveJob({ job_id: data.job_id, status: data.status });
      startPolling(data.job_id);
    } catch (err) {
      setGenError({ code: 'UNKNOWN_ERROR', message: err.message });
      setIsGenerating(false);
    }
  }

  // ── Determine button disabled state and reason ─────────────────────────────
  const tokenConfigured = tftAccount?.token_configured;
  const spendable = tftAccount?.credit_available ?? tftAccount?.credit_balance ?? 1;
  const hasCredits = !tokenConfigured || spendable > 0;
  const hasTrack = nowPlaying?.state === 'playing';
  const match = matchData?.match;
  const hasHighMatch = match?.matched && (match?.confidence === 'high' || match?.confidence === 'medium');
  const lyricsExist =
    match?.track?.lyrics_status === 'HAS_LRC_FILE' ||
    match?.track?.lyrics_status === 'HAS_EMBEDDED_LYRICS';

  let disabledReason = null;
  if (!tokenConfigured) disabledReason = t('tft.no_token');
  else if (!hasCredits) disabledReason = t('tft.no_credits');
  else if (!hasTrack) disabledReason = t('tft.no_track');
  else if (!hasHighMatch) disabledReason = t('tft.no_match');
  else if (lyricsExist && !force) disabledReason = t('tft.lyrics_exist');

  const buttonDisabled = isGenerating || !!disabledReason;

  // Check if the matched file's extension supports embedding
  const matchedPath = match?.track?.path || '';
  const matchedExt = matchedPath
    ? matchedPath.slice(matchedPath.lastIndexOf('.')).toLowerCase()
    : '';
  const embedSupported = !matchedPath || EMBED_SUPPORTED_EXTS.includes(matchedExt);

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('section.textfromtrack')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      <div className="card-body">
      {/* Account info */}
      <div className="status-grid">
        <div className="status-row">
          <span className="label">{t('tft.token_status')}</span>
          <span className={`badge ${tokenConfigured ? 'badge-success' : 'badge-error'}`}>
            {tokenConfigured ? t('tft.token_configured') : t('tft.token_missing')}
          </span>
        </div>

        {tftAccount?.email && (
          <div className="status-row">
            <span className="label">{t('tft.email')}</span>
            <span className="value">{tftAccount.email}</span>
          </div>
        )}

        {tftAccount?.credit_balance != null && (
          <div className="status-row">
            <span className="label">{t('tft.credit_balance')}</span>
            <span className={`value ${(tftAccount.credit_available ?? tftAccount.credit_balance) <= 0 ? 'text-error' : ''}`}>
              {tftAccount.credit_available != null && tftAccount.credit_available !== tftAccount.credit_balance ? (
                <>
                  <strong>{tftAccount.credit_available}</strong>
                  {' '}
                  <span className="muted small">
                    ({t('tft.credit_breakdown', {
                      balance: tftAccount.credit_balance,
                      reserved: tftAccount.credit_reserved ?? 0,
                    })})
                  </span>
                </>
              ) : (
                tftAccount.credit_balance
              )}
              {tftAccount.top_up_url && (
                <>
                  {' '}
                  <a href={tftAccount.top_up_url} target="_blank" rel="noreferrer" className="link-small">
                    {t('tft.top_up')} ↗
                  </a>
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Generate button */}
      <div className="generate-area">
        {lyricsExist && (
          <label className="embed-toggle force-toggle">
            <input
              type="checkbox"
              checked={force}
              disabled={isGenerating}
              onChange={e => setForce(e.target.checked)}
            />
            <span>{t('tft.force_retranscribe')}</span>
          </label>
        )}
        {lyricsExist && force && (
          <p className="muted small force-warning">{t('tft.force_warning')}</p>
        )}

        <label className="embed-toggle">
          <input
            type="checkbox"
            checked={embed && embedSupported}
            disabled={isGenerating || !embedSupported}
            onChange={e => setEmbed(e.target.checked)}
          />
          <span>{t('tft.embed_lyrics')}</span>
        </label>
        {!embedSupported && matchedPath && (
          <p className="muted small">
            {t('tft.embed_unsupported', { ext: matchedExt || '?' })}
          </p>
        )}

        {embed && embedSupported && (
          <label className="embed-toggle">
            <input
              type="checkbox"
              checked={backup}
              disabled={isGenerating}
              onChange={e => setBackup(e.target.checked)}
            />
            <span>{t('tft.backup_before_embed')}</span>
          </label>
        )}

        <button
          className="btn btn-primary btn-large"
          onClick={handleGenerate}
          disabled={buttonDisabled}
        >
          {isGenerating ? t('tft.generating') : t('tft.generate_button')}
        </button>

        {disabledReason && !isGenerating && (
          <p className="muted small">{disabledReason}</p>
        )}
      </div>

      {/* Progress */}
      {activeJob && (
        <div className={`progress-box ${activeJob.status === 'error' ? 'progress-error' : activeJob.status === 'done' ? 'progress-done' : 'progress-active'}`}>
          <div className="progress-status">
            {t(PROGRESS_KEYS[activeJob.status] || 'common.loading')}
          </div>
          {activeJob.status === 'done' && activeJob.lrc_file && (
            <div className="progress-detail muted small">
              {t('tft.lrc_saved')}: {activeJob.lrc_file}
            </div>
          )}
          {activeJob.status === 'done' && activeJob.lyrics_embedded && (
            <div className="progress-detail embed-success">
              🏷️ {t('tft.lyrics_embedded_ok')}
            </div>
          )}
          {activeJob.status === 'done' && activeJob.embed_requested && !activeJob.lyrics_embedded && (
            <div className="progress-detail text-error small">
              ⚠ {t('tft.lyrics_embed_failed')}
              {activeJob.embed_error ? `: ${activeJob.embed_error}` : ''}
            </div>
          )}
          {activeJob.status === 'done' && activeJob.credits_charged != null && (
            <div className="progress-detail muted small">
              {t('tft.credits_charged')}: {activeJob.credits_charged}
            </div>
          )}
          {activeJob.status === 'error' && activeJob.error && (
            <div className="progress-detail text-error small">
              [{activeJob.error.code}] {activeJob.error.message}
            </div>
          )}
        </div>
      )}

      {/* Error from generate attempt */}
      {genError && !activeJob && (
        <div className="alert alert-error">
          <strong>[{genError.code}]</strong> {genError.message}
        </div>
      )}
      </div>
    </section>
  );
}
