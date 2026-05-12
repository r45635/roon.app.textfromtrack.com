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
  const [tftOptions, setTftOptions] = useState({ audioType: 'auto', timestamps: 'auto', language: '', vintage: false });
  const [showHelp, setShowHelp] = useState(false);
  const [lowConfirmOverride, setLowConfirmOverride] = useState(false);
  const pollingRef = useRef(null);
  const sseRef = useRef(null);

  // Cleanup polling + SSE on unmount
  useEffect(() => () => {
    clearInterval(pollingRef.current);
    sseRef.current?.close();
  }, []);

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

  // Reset low-confidence override when the matched file changes
  const _matchedPathForReset = matchData?.match?.track?.path;
  useEffect(() => {
    setLowConfirmOverride(false);
  }, [_matchedPathForReset]);

  async function fetchJobById(jobId) {
    try {
      const res = await fetch(`/api/tft/jobs/${jobId}`);
      const data = await res.json();
      if (!data.success) return;
      const job = data.job;
      setActiveJob(job);
      if (job.status === 'done' || job.status === 'error') {
        clearInterval(pollingRef.current);
        sseRef.current?.close();
        sseRef.current = null;
        setIsGenerating(false);
        if (onGenerated) onGenerated();
      }
    } catch {
      // silent — will retry next tick
    }
  }

  function startJobTracking(jobId) {
    // Primary: SSE — backend pushes job_updated events immediately
    let sseActive = false;
    try {
      const es = new EventSource('/api/tft/events');
      sseRef.current = es;
      sseActive = true;
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'job_updated' && msg.job_id === jobId) {
            fetchJobById(jobId);
          }
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => {
        es.close();
        sseRef.current = null;
      };
    } catch { /* SSE not available — fall through to polling */ }

    // Fallback polling: 2s when no SSE, 5s as belt-and-suspenders when SSE is active
    pollingRef.current = setInterval(() => fetchJobById(jobId), sseActive ? 5000 : 2000);
  }

  async function handleGenerate() {
    setGenError(null);
    setActiveJob(null);
    setIsGenerating(true);

    try {
      const body = { embed, backup, force };
      // Low-confidence override: pass confirmed_path so the server skips the confidence gate
      if (hasLowMatch && lowConfirmOverride && match?.track?.path) {
        body.confirmed_path = match.track.path;
      }
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

      if (!data.success) {
        setGenError(data.error);
        setIsGenerating(false);
        return;
      }

      setActiveJob({ job_id: data.job_id, status: data.status });
      startJobTracking(data.job_id);
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
  const hasLowMatch = match?.matched && match?.confidence === 'low';
  const hasHighMatch = match?.matched && (match?.confidence === 'high' || match?.confidence === 'medium');
  const hasUsableMatch = hasHighMatch || (hasLowMatch && lowConfirmOverride);
  const lyricsExist =
    match?.track?.lyrics_status === 'HAS_LRC_FILE' ||
    match?.track?.lyrics_status === 'HAS_EMBEDDED_LYRICS' ||
    match?.track?.lyrics_status === 'HAS_CACHED_LYRICS';

  let disabledReason = null;
  if (!tokenConfigured) disabledReason = t('tft.no_token');
  else if (!hasCredits) disabledReason = t('tft.no_credits');
  else if (!hasTrack) disabledReason = t('tft.no_track');
  else if (!hasUsableMatch && !hasLowMatch) disabledReason = t('tft.no_match');
  else if (hasLowMatch && !lowConfirmOverride) disabledReason = t('tft.low_confidence_confirm_required');
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

        {/* Advanced options block */}
        <div className="tft-options-block">
          <div className="tft-options-header">
            {t('tft.options_title')}
            <button
              className="tft-options-help-btn"
              onClick={() => setShowHelp(true)}
              title={t('tft.options_help_label')}
              type="button"
            >ⓘ</button>
          </div>

          {/* Audio type */}
          <div className="tft-options-row">
            <span className="tft-options-label">{t('tft.audio_type_label')}</span>
            <div className="tft-options-radios">
              {['auto', 'speech', 'music'].map(v => (
                <button
                  key={v}
                  type="button"
                  className={`tft-radio-btn${tftOptions.audioType === v ? ' tft-radio-btn-active' : ''}`}
                  disabled={isGenerating}
                  onClick={() => setTftOptions(o => ({ ...o, audioType: v }))}
                >
                  {t(`tft.audio_type_${v}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Timestamps */}
          <div className="tft-options-row">
            <span className="tft-options-label">{t('tft.timestamps_label')}</span>
            <div className="tft-options-radios">
              {['auto', 'required', 'none'].map(v => (
                <button
                  key={v}
                  type="button"
                  className={`tft-radio-btn${tftOptions.timestamps === v ? ' tft-radio-btn-active' : ''}`}
                  disabled={isGenerating}
                  onClick={() => setTftOptions(o => ({ ...o, timestamps: v }))}
                >
                  {t(`tft.timestamps_${v}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div className="tft-options-row">
            <label htmlFor="tft-language" className="tft-options-label">{t('tft.language_label')}</label>
            <input
              id="tft-language"
              list="tft-language-list"
              className="tft-options-text-input"
              value={tftOptions.language}
              onChange={e => setTftOptions(o => ({ ...o, language: e.target.value }))}
              placeholder={t('tft.language_auto')}
              disabled={isGenerating}
            />
            <datalist id="tft-language-list">
              <option value="fr" /><option value="en" /><option value="es" />
              <option value="de" /><option value="it" /><option value="pt" />
              <option value="ja" /><option value="ko" /><option value="zh" />
              <option value="ar" /><option value="ru" />
            </datalist>
          </div>

          {/* Vintage */}
          <label className="embed-toggle">
            <input
              type="checkbox"
              checked={tftOptions.vintage}
              disabled={isGenerating}
              onChange={e => setTftOptions(o => ({ ...o, vintage: e.target.checked }))}
            />
            <span>{t('tft.vintage_label')}</span>
          </label>
        </div>

        {/* Help modal */}
        {showHelp && (
          <div className="tft-help-backdrop" onClick={() => setShowHelp(false)}>
            <div className="tft-help-modal" onClick={e => e.stopPropagation()}>
              <h3>{t('tft.help_modal_title')}</h3>
              <dl>
                <div><dt>{t('tft.help_audio_type_title')}</dt><dd>{t('tft.help_audio_type')}</dd></div>
                <div><dt>{t('tft.help_timestamps_title')}</dt><dd>{t('tft.help_timestamps')}</dd></div>
                <div><dt>{t('tft.help_language_title')}</dt><dd>{t('tft.help_language')}</dd></div>
                <div><dt>{t('tft.help_vintage_title')}</dt><dd>{t('tft.help_vintage')}</dd></div>
              </dl>
              <button className="btn btn-secondary tft-help-close" onClick={() => setShowHelp(false)}>
                {t('common.close') || 'Close'}
              </button>
            </div>
          </div>
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

        {hasLowMatch && !lowConfirmOverride && !isGenerating && (
          <div className="alert alert-warning" style={{ marginTop: '0.5rem' }}>
            <p style={{ marginBottom: '0.5rem' }}>{t('tft.low_confidence_warning')}</p>
            <label className="embed-toggle">
              <input
                type="checkbox"
                checked={lowConfirmOverride}
                onChange={e => setLowConfirmOverride(e.target.checked)}
              />
              <span>{t('tft.low_confidence_confirm')}</span>
            </label>
          </div>
        )}
        {hasLowMatch && lowConfirmOverride && !isGenerating && (
          <label className="embed-toggle" style={{ marginTop: '0.25rem' }}>
            <input
              type="checkbox"
              checked={lowConfirmOverride}
              onChange={e => setLowConfirmOverride(e.target.checked)}
            />
            <span className="muted small">{t('tft.low_confidence_confirm')}</span>
          </label>
        )}

        {disabledReason && !isGenerating && !(hasLowMatch && !lowConfirmOverride) && (
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
          {activeJob.status === 'done' && activeJob.quality?.verdict === 'degraded' && (
            <div className="progress-detail quality-warning">
              <details>
                <summary>
                  ⚠️ {t('tft.quality_degraded')}
                  {activeJob.quality.hallucinations_filtered > 0 && (
                    <span> ({activeJob.quality.hallucinations_filtered} {t('tft.quality_hallucinations_count')})</span>
                  )}
                </summary>
                {activeJob.quality.avg_confidence != null && (
                  <p className="muted small">{t('tft.quality_avg_score')}: {activeJob.quality.avg_confidence.toFixed(2)}</p>
                )}
              </details>
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
