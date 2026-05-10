import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

async function revealInFinder(filePath) {
  await fetch('/api/tft/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
}

const STATUS_CLASS = {
  done: 'badge-success',
  pending: 'badge-neutral',
  processing: 'badge-info',
  downloading: 'badge-info',
  embedding: 'badge-info',
  error: 'badge-error',
  superseded: 'badge-neutral',
};

const EMBED_SUPPORTED_EXTS = ['.mp3', '.flac'];

function getExt(filePath) {
  if (!filePath) return '';
  const idx = filePath.lastIndexOf('.');
  return idx >= 0 ? filePath.slice(idx).toLowerCase() : '';
}

export default function JobHistory({ jobs, onJobRetried }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('job-history');
  const [retrying, setRetrying] = useState(null);
  const [retryError, setRetryError] = useState({});
  const [embedding, setEmbedding] = useState(null);
  const [embedError, setEmbedError] = useState({});
  const [locallyEmbedded, setLocallyEmbedded] = useState(() => new Set());
  const [backupDefault, setBackupDefault] = useState(true);
  const [conflictDialog, setConflictDialog] = useState(null);
  // ^ { jobId, backupPath } when the backup file already exists and the user
  //   must choose between keep / overwrite / no-backup / cancel.

  useEffect(() => {
    fetch('/api/music/config')
      .then(r => r.json())
      .then(data => {
        if (data?.success) setBackupDefault(data.backup_before_embed_default !== false);
      })
      .catch(() => { /* keep default true */ });
  }, []);

  async function postEmbed(jobId, payload) {
    const res = await fetch('/api/tft/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, ...payload }),
    });
    return res.json();
  }

  async function handleEmbed(jobId, conflictChoice = null) {
    setEmbedding(jobId);
    setEmbedError(prev => ({ ...prev, [jobId]: null }));
    try {
      const payload = { backup: backupDefault };
      if (conflictChoice) {
        // 'keep' | 'overwrite' | 'no-backup'
        if (conflictChoice === 'no-backup') payload.backup = false;
        else payload.backup_conflict = conflictChoice;
      }
      const data = await postEmbed(jobId, payload);

      // Backup conflict — ask the user what to do, retry with their choice
      if (!data.success && data.error?.code === 'BACKUP_EXISTS') {
        setConflictDialog({
          jobId,
          backupPath: data.error.details?.backup_path || `${jobId}.org`,
        });
        setEmbedding(null);
        return;
      }

      // "Already embedded" is idempotent success
      const alreadyEmbedded = !data.success
        && /already embedded/i.test(data.error?.message || '');
      if (data.success || alreadyEmbedded) {
        setLocallyEmbedded(prev => {
          const next = new Set(prev);
          next.add(jobId);
          return next;
        });
        if (onJobRetried) onJobRetried(jobId);
      } else {
        setEmbedError(prev => ({ ...prev, [jobId]: data.error?.message || 'Error' }));
      }
    } catch (err) {
      setEmbedError(prev => ({ ...prev, [jobId]: err.message }));
    } finally {
      setEmbedding(null);
    }
  }

  function resolveConflict(choice) {
    if (!conflictDialog) return;
    const { jobId } = conflictDialog;
    setConflictDialog(null);
    if (choice === 'cancel') return;
    handleEmbed(jobId, choice);
  }

  async function handleRetry(jobId) {
    setRetrying(jobId);
    setRetryError(prev => ({ ...prev, [jobId]: null }));
    try {
      const res = await fetch('/api/tft/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      const data = await res.json();
      if (!data.success) {
        setRetryError(prev => ({ ...prev, [jobId]: data.error?.message || 'Error' }));
      } else if (onJobRetried) {
        onJobRetried(data.job_id);
      }
    } catch (err) {
      setRetryError(prev => ({ ...prev, [jobId]: err.message }));
    } finally {
      setRetrying(null);
    }
  }

  if (!jobs || jobs.length === 0) {
    return (
      <section className={`card${collapsed ? ' collapsed' : ''}`}>
        <div className="card-header">
          <h2>{t('section.job_history')}</h2>
          <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
            {collapsed ? '▶' : '▼'}
          </button>
        </div>
        <div className="card-body">
          <p className="muted">{t('jobs.empty')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('section.job_history')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      <div className="card-body">
      <div className="jobs-scroll">
      <div className="table-wrapper">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>{t('jobs.date')}</th>
              <th>{t('jobs.track')}</th>
              <th>{t('jobs.artist')}</th>
              <th>{t('jobs.status')}</th>
              <th>{t('jobs.credits')}</th>
              <th>{t('jobs.lrc_path')}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(job => (
              <tr key={job.job_id} className={job.status === 'error' ? 'row-error' : ''}>
                <td className="td-date">
                  {job.created_at
                    ? new Date(job.created_at).toLocaleString()
                    : t('common.na')}
                </td>
                <td className="td-truncate" title={job.title || ''}>{job.title || t('common.na')}</td>
                <td className="td-truncate" title={job.artist || ''}>{job.artist || t('common.na')}</td>
                <td>
                  <div className="status-badges">
                    <span className={`badge badge-sm ${STATUS_CLASS[job.status] || 'badge-neutral'}`}>
                      {t(`jobs.status_${job.status}`, job.status)}
                    </span>
                    {job.status === 'done' && job.has_timestamps === false && (() => {
                      // Three sub-cases for the "no sync" badge:
                      //  1. timestamps_mode === requested  → TFT honored but model couldn't produce timestamps
                      //  2. timestamps_mode !== requested  → TFT downgraded the mode (e.g. requested 'required' → applied 'auto')
                      //  3. timestamps_mode == null        → TFT didn't echo the field; v1.7 likely not deployed and our param was ignored
                      const requested = job.timestamps_requested || 'required';
                      let tip;
                      let modeSuffix = null;
                      if (!job.timestamps_mode) {
                        tip = t('jobs.no_timestamps_tip_v17_missing', { requested });
                        modeSuffix = '?';
                      } else if (job.timestamps_mode !== requested) {
                        tip = t('jobs.no_timestamps_tip_with_mode', { mode: job.timestamps_mode, requested });
                        modeSuffix = job.timestamps_mode;
                      } else {
                        tip = t('jobs.no_timestamps_tip');
                      }
                      return (
                        <span className="badge badge-sm badge-warning" title={tip}>
                          ⚠️ {t('jobs.no_timestamps')}
                          {modeSuffix && <> · {modeSuffix}</>}
                        </span>
                      );
                    })()}
                    {job.status === 'done' && (job.lyrics_embedded || locallyEmbedded.has(job.job_id)) && (
                      <span className="badge badge-sm badge-success" title={t('jobs.embedded_tip')}>
                        🏷️ {t('jobs.embedded')}
                      </span>
                    )}
                  </div>
                </td>
                <td>{job.credits_charged ?? job.credits_quoted ?? t('common.na')}</td>
                <td className="td-path">
                  {job.lrc_file ? (
                    <span className="lrc-reveal-wrap" title={job.lrc_file}>
                      <span className="path small">{job.lrc_file.split('/').pop()}</span>
                      <button
                        className="reveal-btn"
                        title={t('jobs.reveal')}
                        onClick={() => revealInFinder(job.lrc_file)}
                      >
                        📂
                      </button>
                      {job.has_timestamps === false && (
                        <button
                          className="retry-btn"
                          title={t('jobs.retry_tip')}
                          disabled={retrying === job.job_id}
                          onClick={() => handleRetry(job.job_id)}
                        >
                          {retrying === job.job_id ? '…' : '🔄'}
                        </button>
                      )}
                      {job.status === 'done'
                        && !job.lyrics_embedded
                        && !locallyEmbedded.has(job.job_id)
                        && EMBED_SUPPORTED_EXTS.includes(getExt(job.source_file)) && (
                          <button
                            className="retry-btn"
                            title={t('jobs.embed_tip')}
                            disabled={embedding === job.job_id}
                            onClick={() => handleEmbed(job.job_id)}
                          >
                            {embedding === job.job_id ? '…' : '🏷️'}
                          </button>
                        )}
                      {embedError[job.job_id] && (
                        <span className="text-error small embed-error-msg" title={embedError[job.job_id]}>
                          ⚠ {embedError[job.job_id]}
                        </span>
                      )}
                    </span>
                  ) : job.error ? (
                    <span className="text-error small" title={job.error.message}>
                      [{job.error.code}]
                    </span>
                  ) : (
                    t('common.na')
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      </div>

      {conflictDialog && (
        <div className="modal-backdrop" onClick={() => resolveConflict('cancel')}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>{t('jobs.backup_conflict_title')}</h3>
            <p className="muted small">
              {t('jobs.backup_conflict_body')}
            </p>
            <code className="modal-path">{conflictDialog.backupPath}</code>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => resolveConflict('keep')}>
                {t('jobs.backup_conflict_keep')}
              </button>
              <button className="btn btn-secondary" onClick={() => resolveConflict('overwrite')}>
                {t('jobs.backup_conflict_overwrite')}
              </button>
              <button className="btn btn-ghost" onClick={() => resolveConflict('no-backup')}>
                {t('jobs.backup_conflict_no_backup')}
              </button>
              <button className="btn btn-ghost" onClick={() => resolveConflict('cancel')}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
