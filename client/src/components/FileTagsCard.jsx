import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

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

  useEffect(() => {
    if (!active || !filePath) return;
    if (state.covers !== null) return; // already loaded
    setState({ covers: null, loading: true, error: null });
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

  return (
    <div className="file-tabs-artwork">
      {state.covers.map((c, i) => (
        <img key={i} src={c.data} alt={c.type || 'cover'} className="file-tabs-artwork-img" />
      ))}
    </div>
  );
}

// ─── Right-panel: Lyrics tab ──────────────────────────────────────────────────

function LyricsPanel({ filePath, active }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ text: undefined, loading: false, error: null });

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

  if (state.loading) return <p className="file-tabs-muted">{t('file_tags.loading')}</p>;
  if (state.error)   return <p className="file-tabs-muted file-tabs-error">{state.error}</p>;
  if (state.text === undefined) return null;

  if (!state.text) {
    return <p className="file-tabs-muted">{t('file_tags.no_lyrics', 'Inexistant')}</p>;
  }

  return <pre className="file-tabs-lyrics">{state.text}</pre>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FileTagsCard({ filePath }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('file-tags', true);
  const [activeTab, setActiveTab] = useState('art');
  const [state, setState] = useState({ tags: null, format: null, loading: false, error: null });
  const [panelKey, setPanelKey] = useState(0);

  useEffect(() => {
    if (!filePath) { setState({ tags: null, format: null, loading: false, error: null }); return; }
    setState(s => ({ ...s, loading: true, error: null }));
    setPanelKey(k => k + 1); // force ArtworkPanel + LyricsPanel to remount and re-fetch
    fetch(`/api/music/file-tags?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error?.message || 'Error');
        setState({ tags: d.tags, format: d.format, loading: false, error: null });
      })
      .catch(err => setState({ tags: null, format: null, loading: false, error: err.message }));
  }, [filePath]);

  const { tags, format, loading, error } = state;

  const trackLabel = tags?.track_no != null
    ? (tags.track_total ? `${tags.track_no} / ${tags.track_total}` : String(tags.track_no))
    : null;
  const discLabel = tags?.disc_no != null
    ? (tags.disc_total ? `${tags.disc_no} / ${tags.disc_total}` : String(tags.disc_no))
    : null;

  return (
    <div className="file-tags-card">
      <div className="file-tags-card-header" onClick={toggleCollapsed}>
        <h4>{t('file_tags.section_title')}</h4>
        <span className="muted" style={{ fontSize: 11 }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <div className="file-tags-card-body">
          {loading && <p className="muted small">{t('file_tags.loading')}</p>}
          {error && <p className="muted small" style={{ color: 'var(--tft-error)' }}>{t('file_tags.error')}: {error}</p>}

          {(tags || format) && (
            <div className="file-tags-columns">
              {/* ── Left: Tags + Format ──────────────────────────────── */}
              <div className="file-tags-left">
                {tags && (
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

                {format && (
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
                  {activeTab === 'lyrics' && <LyricsPanel  key={`lyrics-${panelKey}`} filePath={filePath} active />}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

