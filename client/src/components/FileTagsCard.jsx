import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';
import SyncedLyrics from './SyncedLyrics.jsx';

function fmt(seconds) {
  if (seconds == null) return null;
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TagRow({ label, value, mono = false }) {
  if (value == null || value === '') return null;
  return (
    <>
      <span className="file-tags-key">{label}</span>
      <span className={`file-tags-val${mono ? ' mono' : ''}`}>{value}</span>
    </>
  );
}

// ─── Right-panel: Artwork tab ─────────────────────────────────────────────────

function ArtworkPanel({ filePath, active }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ covers: null, loading: false, error: null });
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || !filePath) return;
    if (state.covers !== null) return; // already loaded
    setState({ covers: null, loading: true, error: null });
    setIndex(0);
    fetch(`/api/music/file-cover?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error?.message || 'Error');
        setState({ covers: d.covers, loading: false, error: null });
      })
      .catch(err => setState({ covers: null, loading: false, error: err.message }));
  }, [active, filePath]);

  if (state.loading) return <p className="file-tabs-muted">{t('file_tags.loading')}</p>;
  if (state.error)   return <p className="file-tabs-muted file-tabs-error">{state.error}</p>;
  if (!state.covers) return null;

  if (state.covers.length === 0) {
    return <p className="file-tabs-muted">{t('file_tags.no_cover', 'Aucune vignette')}</p>;
  }

  const cover = state.covers[index];
  const total = state.covers.length;

  return (
    <div className="file-tabs-artwork">
      <img src={cover.data} alt={cover.type || 'cover'} className="file-tabs-artwork-img" />
      {total > 1 && (
        <div className="file-tabs-artwork-nav">
          <button
            className="file-tabs-artwork-nav-btn"
            onClick={() => setIndex(i => (i - 1 + total) % total)}
            aria-label="Previous cover"
          >‹</button>
          <span className="file-tabs-artwork-nav-count">{index + 1} / {total}</span>
          <button
            className="file-tabs-artwork-nav-btn"
            onClick={() => setIndex(i => (i + 1) % total)}
            aria-label="Next cover"
          >›</button>
        </div>
      )}
    </div>
  );
}

// ─── Right-panel: Lyrics tab ──────────────────────────────────────────────────

function LyricsPanel({ filePath, active, onDelete, seekSeconds = 0, isPlaying = false }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ text: undefined, loading: false, error: null });
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // ── Edit mode ─────────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState('');
  const [saveConfirm, setSaveConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!active || !filePath) return;
    if (state.text !== undefined) return; // already loaded
    setState({ text: undefined, loading: true, error: null });
    fetch(`/api/music/file-lyrics?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error?.message || 'Error');
        setState({ text: d.text || null, loading: false, error: null });
      })
      .catch(err => setState({ text: undefined, loading: false, error: err.message }));
  }, [active, filePath]);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await fetch(`/api/music/file-lyrics?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
      const d = await r.json();
      if (!d.success) throw new Error(d.error?.message || 'Error');
      setDeleteConfirm(false);
      onDelete?.();
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const enterEdit = () => {
    setEditText(state.text || '');
    setEditMode(true);
    setSaveConfirm(false);
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setSaveConfirm(false);
    setSaveError(null);
  };

  const doSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch('/api/music/file-lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, lrc_content: editText, embed: true }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error?.message || 'Error');
      setState(s => ({ ...s, text: editText }));
      setEditMode(false);
      setSaveConfirm(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (state.loading) return <p className="file-tabs-muted">{t('file_tags.loading')}</p>;
  if (state.error)   return <p className="file-tabs-muted file-tabs-error">{state.error}</p>;
  if (state.text === undefined) return null;

  // ── Edit mode ─────────────────────────────────────────────────────────────
  if (editMode) {
    return (
      <div className="file-tabs-lyrics-container">
        <textarea
          className="file-tags-textarea"
          value={editText}
          onChange={e => setEditText(e.target.value)}
          spellCheck={false}
        />
        <div className="file-tags-save-bar">
          {saveConfirm ? (
            <>
              <span className="file-tags-save-hint">{t('file_tags.confirm_write')}</span>
              <button className="file-tags-action-btn primary" onClick={doSave} disabled={saving}>
                {saving ? '…' : t('file_tags.confirm_yes')}
              </button>
              <button className="file-tags-action-btn" onClick={() => setSaveConfirm(false)}>
                {t('file_tags.confirm_no')}
              </button>
            </>
          ) : (
            <>
              {saveError && <span className="file-tabs-error file-tags-save-hint" style={{ fontSize: 10 }}>{saveError}</span>}
              <button className="file-tags-action-btn primary" onClick={() => { setSaveError(null); setSaveConfirm(true); }}>
                {t('file_tags.save')}
              </button>
              <button className="file-tags-action-btn" onClick={cancelEdit}>
                {t('file_tags.cancel')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── View mode: no lyrics ──────────────────────────────────────────────────
  if (!state.text) {
    return (
      <div className="file-tabs-lyrics-container">
        <p className="file-tabs-muted">{t('file_tags.no_lyrics')}</p>
        <div className="file-tabs-lyrics-actions">
          <button className="file-tags-action-btn" onClick={enterEdit}>
            ✎ {t('file_tags.edit_lyrics')}
          </button>
        </div>
      </div>
    );
  }

  // ── View mode: has lyrics ─────────────────────────────────────────────────
  return (
    <div className="file-tabs-lyrics-container">
      <SyncedLyrics
        lrcText={state.text}
        seekSeconds={seekSeconds}
        isPlaying={isPlaying}
        defaultSync={false}
        compactHeader
      />
      <div className="file-tabs-lyrics-actions">
        <button className="file-tags-action-btn" onClick={enterEdit}>
          ✎ {t('file_tags.edit_lyrics')}
        </button>
        {deleteConfirm ? (
          <>
            <span className="file-tags-save-hint">{t('file_tags.confirm_delete_lyrics')}</span>
            <button className="file-tags-action-btn danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? '…' : t('file_tags.confirm_yes')}
            </button>
            <button className="file-tags-action-btn" onClick={() => { setDeleteConfirm(false); setDeleteError(null); }}>
              {t('file_tags.confirm_no')}
            </button>
            {deleteError && <span className="file-tabs-error" style={{ fontSize: 10 }}>{deleteError}</span>}
          </>
        ) : (
          <button className="file-tags-action-btn danger-text" onClick={() => setDeleteConfirm(true)}>
            🗑 {t('file_tags.delete_lyrics')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// Editable fields: common name → label key (format section is read-only)
const EDIT_FIELDS = [
  'title', 'artist', 'albumartist', 'album', 'year', 'genre',
  'track', 'disc', 'composer', 'label', 'comment', 'isrc',
];

export default function FileTagsCard({ filePath, refreshKey = 0, nowPlaying = null }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('file-tags', true);
  const [activeTab, setActiveTab] = useState('art');
  const [state, setState] = useState({ tags: null, format: null, loading: false, error: null });
  const [fetchKey, setFetchKey] = useState(0);
  const [panelKey, setPanelKey] = useState(0);

  // ── Edit mode ─────────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [saveConfirm, setSaveConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // refresh both tags and panels (artwork/lyrics)
  const refresh = () => {
    setFetchKey(k => k + 1);
    setPanelKey(k => k + 1);
  };

  // auto-refresh when external refreshKey changes (e.g. after transcription done)
  const prevRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = refreshKey;
      refresh();
    }
  }, [refreshKey]);

  useEffect(() => {
    if (!filePath) { setState({ tags: null, format: null, loading: false, error: null }); return; }
    setState(s => ({ ...s, loading: true, error: null }));
    setPanelKey(k => k + 1);
    fetch(`/api/music/file-tags?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error?.message || 'Error');
        setState({ tags: d.tags, format: d.format, loading: false, error: null });
      })
      .catch(err => setState({ tags: null, format: null, loading: false, error: err.message }));
  }, [filePath, fetchKey]);

  const { tags, format, loading, error } = state;

  const enterEditMode = () => {
    if (!tags) return;
    const track = tags.track_no != null
      ? (tags.track_total ? `${tags.track_no}/${tags.track_total}` : `${tags.track_no}`) : '';
    const disc = tags.disc_no != null
      ? (tags.disc_total ? `${tags.disc_no}/${tags.disc_total}` : `${tags.disc_no}`) : '';
    setEditValues({
      title: tags.title || '', artist: tags.artist || '', albumartist: tags.albumartist || '',
      album: tags.album || '', year: tags.year ? String(tags.year) : '', genre: tags.genre || '',
      track, disc, composer: tags.composer || '', label: tags.label || '',
      comment: tags.comment || '', isrc: tags.isrc || '',
    });
    setEditMode(true);
    setSaveConfirm(false);
    setSaveError(null);
  };

  const cancelEdit = () => { setEditMode(false); setSaveConfirm(false); setSaveError(null); };

  const doSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/music/file-tags?path=${encodeURIComponent(filePath)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: editValues }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error?.message || 'Error');
      setEditMode(false);
      setSaveConfirm(false);
      refresh();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const trackLabel = tags?.track_no != null
    ? (tags.track_total ? `${tags.track_no} / ${tags.track_total}` : String(tags.track_no)) : null;
  const discLabel = tags?.disc_no != null
    ? (tags.disc_total ? `${tags.disc_no} / ${tags.disc_total}` : String(tags.disc_no)) : null;

  return (
    <div className="file-tags-card">
      <div className="file-tags-card-header" onClick={toggleCollapsed}>
        <h4>{t('file_tags.section_title')}{editMode && <span className="file-tags-edit-badge">{t('file_tags.editing')}</span>}</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading && !editMode && <span className="muted" style={{ fontSize: 10 }}>…</span>}
          {tags && !editMode && (
            <button className="file-tags-refresh-btn" title={t('file_tags.edit')}
              onClick={e => { e.stopPropagation(); enterEditMode(); }}>✎</button>
          )}
          {!editMode && (
            <button className="file-tags-refresh-btn" title={t('file_tags.refresh')}
              onClick={e => { e.stopPropagation(); refresh(); }}>↺</button>
          )}
          {editMode && (
            <button className="file-tags-refresh-btn" title={t('file_tags.cancel')}
              onClick={e => { e.stopPropagation(); cancelEdit(); }}>✕</button>
          )}
          <span className="muted" style={{ fontSize: 11 }}>{collapsed ? '▶' : '▼'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="file-tags-card-body">
          {loading && !editMode && <p className="muted small">{t('file_tags.loading')}</p>}
          {error && <p className="muted small" style={{ color: 'var(--tft-error)' }}>{t('file_tags.error')}: {error}</p>}

          {(tags || format) && (
            <div className="file-tags-columns">
              {/* ── Left: Tags + Format ──────────────────────────────── */}
              <div className="file-tags-left">
                {/* Edit mode: input grid */}
                {editMode && (
                  <div>
                    <p className="file-tags-section-title">{t('file_tags.section_tags')}</p>
                    <div className="file-tags-grid">
                      {EDIT_FIELDS.map(field => (
                        <React.Fragment key={field}>
                          <span className="file-tags-key">{t(`file_tags.${field}`, field)}</span>
                          <input
                            className="file-tags-input"
                            value={editValues[field] || ''}
                            onChange={e => setEditValues(v => ({ ...v, [field]: e.target.value }))}
                          />
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="file-tags-save-bar">
                      {saveConfirm ? (
                        <>
                          <span className="file-tags-save-hint">{t('file_tags.confirm_write')}</span>
                          <button className="file-tags-action-btn primary" onClick={doSave} disabled={saving}>
                            {saving ? '…' : t('file_tags.confirm_yes')}
                          </button>
                          <button className="file-tags-action-btn" onClick={() => setSaveConfirm(false)}>
                            {t('file_tags.confirm_no')}
                          </button>
                        </>
                      ) : (
                        <>
                          {saveError && <span className="file-tabs-error file-tags-save-hint" style={{ fontSize: 10 }}>{saveError}</span>}
                          <button className="file-tags-action-btn primary" onClick={() => { setSaveError(null); setSaveConfirm(true); }}>
                            {t('file_tags.save')}
                          </button>
                          <button className="file-tags-action-btn" onClick={cancelEdit}>
                            {t('file_tags.cancel')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* View mode: read-only TagRows */}
                {!editMode && tags && (
                  <div>
                    <p className="file-tags-section-title">{t('file_tags.section_tags')}</p>
                    <div className="file-tags-grid">
                      <TagRow label={t('file_tags.title')}       value={tags.title} />
                      <TagRow label={t('file_tags.artist')}      value={tags.artist} />
                      <TagRow label={t('file_tags.albumartist')} value={tags.albumartist} />
                      <TagRow label={t('file_tags.album')}       value={tags.album} />
                      <TagRow label={t('file_tags.year')}        value={tags.year} />
                      <TagRow label={t('file_tags.genre')}       value={tags.genre} />
                      <TagRow label={t('file_tags.track')}       value={trackLabel} />
                      <TagRow label={t('file_tags.disc')}        value={discLabel} />
                      <TagRow label={t('file_tags.composer')}    value={tags.composer} />
                      <TagRow label={t('file_tags.label')}       value={tags.label} />
                      <TagRow label={t('file_tags.comment')}     value={tags.comment} />
                      <TagRow label={t('file_tags.isrc')}        value={tags.isrc} mono />
                      <TagRow label={t('file_tags.mbid')}        value={tags.musicbrainz_trackid} mono />
                      <TagRow label={t('file_tags.mb_albumid')}  value={tags.musicbrainz_albumid} mono />
                    </div>
                  </div>
                )}

                {!editMode && format && (
                  <div>
                    <p className="file-tags-section-title">{t('file_tags.section_format')}</p>
                    <div className="file-tags-grid">
                      <TagRow label={t('file_tags.codec')}      value={format.codec} />
                      <TagRow label={t('file_tags.container')}  value={format.container} />
                      {format.bitrate_kbps != null && (
                        <>
                          <span className="file-tags-key">{t('file_tags.bitrate')}</span>
                          <span className="file-tags-val">{t('file_tags.bitrate_kbps', { v: format.bitrate_kbps })}</span>
                        </>
                      )}
                      {format.sample_rate_hz != null && (
                        <>
                          <span className="file-tags-key">{t('file_tags.sample_rate')}</span>
                          <span className="file-tags-val">{t('file_tags.sample_rate_hz', { v: format.sample_rate_hz.toLocaleString() })}</span>
                        </>
                      )}
                      {format.bits_per_sample != null && (
                        <>
                          <span className="file-tags-key">{t('file_tags.bits_per_sample')}</span>
                          <span className="file-tags-val">{t('file_tags.bits_per_sample_val', { v: format.bits_per_sample })}</span>
                        </>
                      )}
                      {format.channels != null && (
                        <TagRow label={t('file_tags.channels')} value={String(format.channels)} />
                      )}
                      {format.lossless != null && (
                        <>
                          <span className="file-tags-key">{t('file_tags.lossless')}</span>
                          <span className="file-tags-val">
                            <span className={`file-tags-badge${format.lossless ? '' : ' no'}`}>
                              {format.lossless ? t('file_tags.yes') : t('file_tags.no')}
                            </span>
                          </span>
                        </>
                      )}
                      {format.duration_seconds != null && (
                        <TagRow label={t('file_tags.duration')} value={fmt(format.duration_seconds)} />
                      )}
                      {format.tag_types?.length > 0 && (
                        <TagRow label={t('file_tags.tag_types')} value={format.tag_types.join(', ')} mono />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Right: Tabs ──────────────────────────────────────── */}
              <div className="file-tags-right">
                <div className="file-tabs-bar">
                  <button
                    className={`file-tab-btn${activeTab === 'art' ? ' active' : ''}`}
                    onClick={() => setActiveTab('art')}
                  >
                    {t('file_tags.tab_art', 'Vignette')}
                  </button>
                  <button
                    className={`file-tab-btn${activeTab === 'lyrics' ? ' active' : ''}`}
                    onClick={() => setActiveTab('lyrics')}
                  >
                    {t('file_tags.tab_lyrics', 'Paroles')}
                  </button>
                </div>
                <div className="file-tabs-content">
                  {activeTab === 'art'    && <ArtworkPanel key={`art-${panelKey}`}    filePath={filePath} active />}
                  {activeTab === 'lyrics' && <LyricsPanel  key={`lyrics-${panelKey}`} filePath={filePath} active
                    onDelete={() => { setPanelKey(k => k + 1); }}
                    seekSeconds={nowPlaying?.seek_position_seconds ?? 0}
                    isPlaying={nowPlaying?.state === 'playing'} />}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

