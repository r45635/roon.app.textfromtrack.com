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

const STATUS_LABEL = {
  done:        'Terminé',
  pending:     'En attente',
  processing:  'En cours',
  downloading: 'Téléchargement',
  embedding:   'Intégration',
  error:       'Erreur',
  superseded:  'Annulé',
};

function SvgCheck()       { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function SvgClock()       { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function SvgRefresh()     { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function SvgXCircle()     { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>; }
function SvgMinus()       { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>; }
function SvgWarning()     { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }
function SvgTag()         { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>; }

const STATUS_SVG = {
  done:        <SvgCheck />,
  pending:     <SvgClock />,
  processing:  <SvgRefresh />,
  downloading: <SvgRefresh />,
  embedding:   <SvgRefresh />,
  error:       <SvgXCircle />,
  superseded:  <SvgMinus />,
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
  const [page, setPage] = useState(0);

  const PAGE_SIZE = 10;

  // Reset to first page when the job list changes
  const jobCount = jobs?.length ?? 0;
  useEffect(() => { setPage(0); }, [jobCount]);

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
              <th className="th-date">{t('jobs.date')}</th>
              <th className="th-track">{t('jobs.track')}</th>
              <th className="th-artist">{t('jobs.artist')}</th>
              <th className="th-status">{t('jobs.status')}</th>
              <th className="th-lrc">{t('jobs.track_path')}</th>
              <th className="th-credits">{t('jobs.credits')}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(job => (
              <tr key={job.job_id} className={job.status === 'error' ? 'row-error' : ''}>
                <td className="td-date">
                  {job.created_at ? (
                    <>
                      <span className="td-date-day">{new Date(job.created_at).toLocaleDateString()}</span>
                      <span className="td-date-time">{new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </>
                  ) : t('common.na')}
                </td>
                <td className="td-truncate" title={job.title || ''}>{job.title || t('common.na')}</td>
                <td className="td-truncate" title={job.artist || ''}>{job.artist || t('common.na')}</td>
                <td className="td-status">
                  <div className="status-badges">
                    {/* Main status icon */}
                    <span
                      className={`badge badge-icon ${STATUS_CLASS[job.status] || 'badge-neutral'}`}
                      title={STATUS_LABEL[job.status] ?? job.status}
                      aria-label={STATUS_LABEL[job.status] ?? job.status}
                    >
                      {STATUS_SVG[job.status] ?? job.status[0].toUpperCase()}
                    </span>

                    {/* No-timestamps warning */}
                    {job.status === 'done' && job.has_timestamps === false && (() => {
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
                        <span
                          className="badge badge-icon badge-warning"
                          title={`Sans sync${modeSuffix ? ` · ${modeSuffix}` : ''} — ${tip}`}
                          aria-label="Sans synchronisation"
                        >
                          <SvgWarning />
                        </span>
                      );
                    })()}

                    {/* Embedded tag */}
                    {job.status === 'done' && (job.lyrics_embedded || locallyEmbedded.has(job.job_id)) && (
                      <span
                        className="badge badge-icon badge-success"
                        title={`Intégré — ${t('jobs.embedded_tip')}`}
                        aria-label="Paroles intégrées"
                      >
                        <SvgTag />
                      </span>
                    )}
                  </div>
                </td>
                <td className="td-path">
                  {/* Track path column */}
                  {job.source_file ? (
                    <span className="lrc-reveal-wrap" title={job.source_file}>
                      <button
                        className="lrc-folder-btn"
                        title={t('jobs.reveal')}
                        onClick={() => revealInFinder(job.source_file)}
                        aria-label={t('jobs.reveal')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                      </button>
                      <span className="path small">{job.source_file.split('/').pop()}</span>
                    </span>
                  ) : (
                    t('common.na')
                  )}
                </td>
                <td className="td-credits">
                  {job.source === 'lrclib' ? (
                    <span className="badge badge-neutral" title="Paroles obtenues depuis LRCLIB (gratuit)">LRCLIB</span>
                  ) : job.cache_hit ? (
                    <span className="badge badge-neutral" title="Servi depuis le cache local (0 crédit)">Cache</span>
                  ) : (
                    job.credits_charged ?? job.credits_quoted ?? t('common.na')
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {/* Pagination */}
      {jobs.length > PAGE_SIZE && (
        <div className="jobs-pagination">
          <button
            className="jobs-page-btn"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Précédent
          </button>
          <span className="jobs-page-info">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, jobs.length)} / {jobs.length}
          </span>
          <button
            className="jobs-page-btn"
            onClick={() => setPage(p => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= jobs.length}
          >
            Suivant →
          </button>
        </div>
      )}

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
