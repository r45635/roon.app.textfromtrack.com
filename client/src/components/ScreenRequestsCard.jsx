import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

const POLL_MS = 15_000;
const OFFSET_STEP_MS = 500;

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

function postJson(url, body) {
  return getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function trackOf(tr) {
  return { title: tr.title, artist: tr.artist, album: tr.album || null };
}

/**
 * The songs other screens asked lyrics for (a TFT Panel in direct mode, any LRCLIB client),
 * from GET /api/lyrics/recent — with the corrections the player offers, since without Roon
 * this app never sees those songs play. Shown only once a screen has asked.
 */
export default function ScreenRequestsCard() {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('screen-requests');
  const [tracks, setTracks] = useState([]);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // track_id of the row showing its actions

  const load = useCallback(async () => {
    try {
      const data = await getJson('/api/lyrics/recent');
      setTracks(data.tracks || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!tracks.length) return null;

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('screens.title')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>
      <div className="card-body">
        <p className="muted small">{t('screens.hint')}</p>
        {error && <p className="settings-error" role="alert">{error}</p>}
        <ul className="lib-list">
          {tracks.map(tr => (
            <ScreenRequestRow
              key={tr.track_id}
              tr={tr}
              open={open === tr.track_id}
              onToggle={() => setOpen(o => (o === tr.track_id ? null : tr.track_id))}
              onChanged={load}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function statusPill(tr, t) {
  if (tr.marked_wrong) return { cls: ' amber', text: t('stage.marked_wrong_short') };
  if (tr.error) return { cls: ' amber', text: t('screens.status_error') };
  if (tr.instrumental) return { cls: '', text: t('stage.instrumental_short') };
  if (!tr.found) return { cls: ' amber', text: t('screens.status_none') };
  return { cls: ' signal', text: tr.synced ? t('stage.synced') : t('stage.not_synced') };
}

function ScreenRequestRow({ tr, open, onToggle, onChanged }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [versions, setVersions] = useState(null); // null = not asked, [] = none

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const track = trackOf(tr);
  const markWrong = (wrong) => run(() => postJson('/api/lyrics/wrong', { ...track, wrong }));
  const setOffset = (ms) => run(() => postJson('/api/lyrics/offset', { ...track, offset_ms: ms }));
  const savePasted = () => run(async () => {
    await postJson('/api/lyrics/custom', { ...track, lrc: pasted });
    setPasting(false);
    setPasted('');
  });
  const choose = (id) => run(async () => {
    await postJson('/api/lyrics/choose', { ...track, lrclib_id: id });
    setVersions(null);
  });
  const loadVersions = () => run(async () => {
    const qs = new URLSearchParams({ title: tr.title, artist: tr.artist });
    if (tr.album) qs.set('album', tr.album);
    if (tr.duration_seconds) qs.set('duration', String(Math.round(tr.duration_seconds)));
    const data = await getJson(`/api/lrclib/search?${qs.toString()}`);
    setVersions(data.hits || []);
  });

  const pill = statusPill(tr, t);
  const offsetS = (tr.offset_ms / 1000).toFixed(1);

  return (
    <li className="lib-row screen-row">
      <button type="button" className="screen-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="lib-row-main">
          <span className="lib-row-title">{tr.title}</span>
          <span className="lib-row-sub">{[tr.artist, tr.album].filter(Boolean).join(' · ')}</span>
        </span>
        {tr.offset_ms !== 0 && <span className="tft-pill">{t('screens.offset', { s: offsetS })}</span>}
        <span className={`tft-pill${pill.cls}`}>{pill.text}</span>
      </button>

      {open && (
        <div className="screen-row-actions">
          <div className="screen-row-buttons">
            {tr.marked_wrong ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => markWrong(false)}>{t('stage.show_anyway')}</button>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} title={t('stage.wrong_title')} onClick={() => markWrong(true)}>{t('stage.wrong')}</button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={loadVersions}>{t('stage.versions')}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setPasting(p => !p)}>{t('stage.paste')}</button>
            <span className="screen-row-offset" aria-label={t('stage.offset_label')}>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} title={t('stage.offset_earlier')} onClick={() => setOffset(tr.offset_ms - OFFSET_STEP_MS)}>−0.5 s</button>
              <span className="tft-mono small">{offsetS} s</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} title={t('stage.offset_later')} onClick={() => setOffset(tr.offset_ms + OFFSET_STEP_MS)}>+0.5 s</button>
              {tr.offset_ms !== 0 && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOffset(0)}>{t('stage.offset_reset')}</button>
              )}
            </span>
          </div>

          {pasting && (
            <div className="screen-row-paste">
              <textarea rows={6} value={pasted} onChange={e => setPasted(e.target.value)} placeholder={t('stage.paste_placeholder')} />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !pasted.trim()} onClick={savePasted}>{t('stage.paste_save')}</button>
            </div>
          )}

          {versions && versions.length === 0 && <p className="muted small">{t('stage.no_versions')}</p>}
          {versions && versions.length > 0 && (
            <ul className="screen-row-versions">
              {versions.map(h => (
                <li key={h.id}>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => choose(h.id)}>
                    {[h.trackName, h.albumName].filter(Boolean).join(' · ')}
                    {h.duration ? ` · ${Math.round(h.duration)} s` : ''}
                    {h.hasSynced ? ` · ${t('stage.synced')}` : ''}
                    {h.damaged ? ` · ${t('stage.damaged')}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="muted small">{t('screens.applies_next')}</p>
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
      )}
    </li>
  );
}
