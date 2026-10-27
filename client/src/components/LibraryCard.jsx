import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';
import { maskPath } from '../lib/privacy.js';

const PAGE_SIZE = 50;

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

/**
 * Library lyrics — which scanned tracks have lyrics, and a batch that fetches the
 * missing ones from LRCLIB and writes them into the files.
 */
export default function LibraryCard({ refreshKey = 0 }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('library-card');
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('missing');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [plainToo, setPlainToo] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadSummary = useCallback(async () => {
    try { setSummary(await getJson('/api/library/summary')); } catch (err) { setError(err.message); }
  }, []);

  const loadList = useCallback(async () => {
    const qs = new URLSearchParams({ status: filter, q: debouncedQuery, offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
    try {
      setList(await getJson(`/api/library/tracks?${qs.toString()}`));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [filter, debouncedQuery, page]);

  useEffect(() => { loadSummary(); }, [loadSummary, refreshKey]);
  useEffect(() => { if (!collapsed) loadList(); }, [loadList, collapsed, refreshKey]);

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQuery(query.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [query]);

  // Follow a running batch or scan; refresh the list when it ends.
  const batch = summary?.batch;
  const busy = !!(batch?.running || summary?.scan?.in_progress);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) loadList();
    wasBusy.current = busy;
    if (!busy) return undefined;
    const id = setInterval(loadSummary, 2000);
    return () => clearInterval(id);
  }, [busy, loadSummary, loadList]);

  async function startBatch() {
    setStarting(true);
    setError(null);
    try {
      const data = await getJson('/api/library/lrclib-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: filter, q: debouncedQuery, synced_only: !plainToo }),
      });
      setSummary(s => ({ ...s, batch: data.batch }));
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function cancelBatch() {
    try {
      const data = await getJson('/api/library/lrclib-batch/cancel', { method: 'POST' });
      setSummary(s => ({ ...s, batch: data.batch }));
    } catch (err) {
      setError(err.message);
    }
  }

  const counts = summary?.counts;
  const withLyrics = counts ? counts.lrc_file + counts.embedded : 0;
  const pct = counts?.total ? Math.round((withLyrics / counts.total) * 100) : 0;
  const total = list?.total ?? 0;

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('library.title')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      <div className="card-body">
        {counts && (
          <div className="lib-coverage">
            <p>
              {counts.total === 0
                ? t('library.empty')
                : t('library.coverage', { total: counts.total, with: withLyrics, pct, missing: counts.missing })}
            </p>
            {counts.total > 0 && (
              <div className="lib-coverage-bar" role="img" aria-label={t('library.coverage_bar', { pct })}>
                <span className="lib-seg lib-seg--lrc" style={{ width: `${(counts.lrc_file / counts.total) * 100}%` }} title={t('library.lrc_files', { count: counts.lrc_file })} />
                <span className="lib-seg lib-seg--emb" style={{ width: `${(counts.embedded / counts.total) * 100}%` }} title={t('library.embedded', { count: counts.embedded })} />
              </div>
            )}
            {counts.total > 0 && (
              <p className="muted small">
                {t('library.lrc_files', { count: counts.lrc_file })} · {t('library.embedded', { count: counts.embedded })}
              </p>
            )}
          </div>
        )}

        {batch && (batch.running || batch.finished_at) && (
          <BatchStatus batch={batch} onCancel={cancelBatch} />
        )}

        <div className="lib-toolbar">
          <div className="lib-filters" role="tablist" aria-label={t('library.filter')}>
            {['missing', 'with', 'all'].map(f => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={`lib-filter${filter === f ? ' active' : ''}`}
                onClick={() => { setFilter(f); setPage(0); }}
              >{t(`library.filter_${f}`)}</button>
            ))}
          </div>
          <input
            className="lib-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('library.search_placeholder')}
            aria-label={t('library.search_placeholder')}
          />
        </div>

        {filter !== 'with' && total > 0 && !batch?.running && (
          <div className="lib-batch-start">
            <button type="button" className="btn btn-primary btn-sm" onClick={startBatch} disabled={starting || busy}>
              {t('library.batch_start', { count: total })}
            </button>
            <label className="lib-plain-toggle">
              <input type="checkbox" checked={plainToo} onChange={e => setPlainToo(e.target.checked)} />
              {t('library.batch_plain_too')}
            </label>
            <p className="muted small">{t('library.batch_hint')}</p>
          </div>
        )}

        {error && <p className="settings-error" role="alert">{error}</p>}

        {list && list.tracks.length === 0 && <p className="muted">{t('library.no_tracks')}</p>}
        {list && list.tracks.length > 0 && (
          <ul className="lib-list">
            {list.tracks.map(tr => (
              <li key={tr.path} className="lib-row" title={maskPath(tr.path)}>
                <span className="lib-row-main">
                  <span className="lib-row-title">{tr.title || tr.path.split('/').pop()}</span>
                  <span className="lib-row-sub">{[tr.artist, tr.album].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={`tft-pill${tr.lyrics_status === 'NO_LOCAL_LYRICS' || tr.lyrics_status === 'UNKNOWN' ? ' amber' : ' signal'}`}>
                  {t(`lyrics_status.${tr.lyrics_status}`, tr.lyrics_status)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <div className="jobs-pagination">
            <button className="jobs-page-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>{t('jobs.prev')}</button>
            <span className="jobs-page-info">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}</span>
            <button className="jobs-page-btn" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>{t('jobs.next')}</button>
          </div>
        )}
      </div>
    </section>
  );
}

function BatchStatus({ batch, onCancel }) {
  const { t } = useTranslation();
  const pct = batch.total ? Math.round((batch.done / batch.total) * 100) : 0;
  const waitingSecs = batch.waiting_until
    ? Math.max(0, Math.round((new Date(batch.waiting_until).getTime() - Date.now()) / 1000))
    : null;
  return (
    <div className={`lib-batch${batch.running ? ' running' : ''}`} role="status">
      <div className="lib-batch-head">
        <strong>
          {batch.running ? t('library.batch_running', { done: batch.done, total: batch.total })
            : batch.cancelled ? t('library.batch_cancelled', { done: batch.done, total: batch.total })
            : t('library.batch_done', { total: batch.total })}
        </strong>
        {batch.running && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{t('common.cancel')}</button>}
      </div>
      <div className="lib-batch-bar"><span style={{ width: `${pct}%` }} /></div>
      {batch.running && batch.current && (
        <p className="muted small">{batch.current.artist} — {batch.current.title}</p>
      )}
      {waitingSecs != null && (
        <p className="small lib-batch-wait">{t('library.batch_waiting', { secs: waitingSecs, msg: batch.wait_reason })}</p>
      )}
      <p className="small">
        {t('library.batch_counts', {
          saved: batch.saved, not_found: batch.not_found, plain: batch.plain_skipped,
          had: batch.already_had, failed: batch.failed,
        })}
      </p>
      {batch.errors?.length > 0 && (
        <details className="small">
          <summary>{t('library.batch_errors', { count: batch.errors.length })}</summary>
          <ul className="lib-batch-errors">
            {batch.errors.map((e, i) => (
              <li key={i}>{e.artist ? `${e.artist} — ${e.title}: ` : ''}{e.error}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
