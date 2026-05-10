import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

function LyricsStatusBadge({ status }) {
  const { t } = useTranslation();
  const cls = {
    HAS_LRC_FILE: 'badge-success',
    HAS_EMBEDDED_LYRICS: 'badge-info',
    NO_LOCAL_LYRICS: 'badge-warning',
    UNKNOWN: 'badge-neutral',
  }[status] || 'badge-neutral';

  return (
    <span className={`badge ${cls}`}>
      {t(`lyrics_status.${status}`, status)}
    </span>
  );
}

function ConfidenceBadge({ confidence }) {
  const { t } = useTranslation();
  const cls = {
    high: 'badge-success',
    medium: 'badge-warning',
    low: 'badge-error',
    none: 'badge-neutral',
  }[confidence] || 'badge-neutral';

  return (
    <span className={`badge ${cls}`}>
      {t(`match.confidence_${confidence}`, confidence)}
    </span>
  );
}

// M1: per-field score chip — green if full, yellow if partial, dim if zero
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

// M1: score breakdown row — only shown when score_detail is available
function ScoreDetail({ detail }) {
  const { t } = useTranslation();
  if (!detail) return null;
  const fields = [
    { key: 'title',    label: t('match.detail_title',    'Title') },
    { key: 'artist',   label: t('match.detail_artist',   'Artist') },
    { key: 'album',    label: t('match.detail_album',    'Album') },
    { key: 'duration', label: t('match.detail_duration', 'Dur.') },
    { key: 'filename', label: t('match.detail_filename', 'File') },
    { key: 'isrc',     label: 'ISRC' },
  ];
  return (
    <div className="score-detail">
      {fields.map(({ key, label }) => {
        const d = detail[key];
        if (!d) return null;
        return (
          <ScoreChip key={key} label={label} points={d.points} max={d.max} />
        );
      })}
    </div>
  );
}

// ─── File Tags sub-card ───────────────────────────────────────────────────────

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

function FileTagsCard({ filePath }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('file-tags', true);
  const [state, setState] = useState({ tags: null, format: null, loading: false, error: null });

  useEffect(() => {
    if (!filePath) { setState({ tags: null, format: null, loading: false, error: null }); return; }
    setState(s => ({ ...s, loading: true, error: null }));
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
      )}
    </div>
  );
}

// ─── LocalMatch ───────────────────────────────────────────────────────────────

export default function LocalMatch({
  data,
  indexStatus,
  onScan,
  onConfirm,
  confirmedPath,
}) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('local-match');

  const scanning = indexStatus?.scan_in_progress;
  const trackCount = indexStatus?.track_count ?? 0;
  const lastScan = indexStatus?.last_scan_at
    ? new Date(indexStatus.last_scan_at).toLocaleString()
    : null;

  const match = data?.match;
  const track = match?.track;

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('section.local_match')}</h2>
        <div className="card-header-actions">
          <button
            className="btn btn-ghost"
            onClick={onScan}
            disabled={scanning}
          >
            {scanning ? t('match.scan_in_progress') : t('match.scan_library')}
          </button>
          <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
            {collapsed ? '▶' : '▼'}
          </button>
        </div>
      </div>

      <div className="card-body">

      {lastScan && (
        <p className="muted small">
          {t('match.last_scanned')}: {lastScan} — {trackCount.toLocaleString()} tracks
        </p>
      )}

      {!data ? (
        <p className="muted">{trackCount === 0 ? t('match.no_index') : t('common.loading')}</p>
      ) : !match?.matched ? (
        <p className="muted">{t('match.no_match')}</p>
      ) : (
        <>
          <div className="status-grid">
            <div className="status-row">
              <span className="label">{t('match.matched')}</span>
              <span className="badge badge-success">{t('common.yes')}</span>
            </div>
            <div className="status-row">
              <span className="label">{t('match.confidence')}</span>
              <ConfidenceBadge confidence={match.confidence} />
            </div>
            <div className="status-row">
              <span className="label">{t('match.score')}</span>
              <span className="value">{match.score}</span>
            </div>
            {match.score_detail && (
              <div className="status-row full-width">
                <ScoreDetail detail={match.score_detail} />
              </div>
            )}
            {track && (
              <>
                <div className="status-row">
                  <span className="label">{t('match.lyrics_status')}</span>
                  <LyricsStatusBadge status={track.lyrics_status} />
                </div>
                <div className="status-row">
                  <span className="label">{t('match.file_size')}</span>
                  <span className="value">
                    {track.size_bytes ? `${(track.size_bytes / 1024 / 1024).toFixed(1)} ${t('common.mb_abbr')}` : t('common.na')}
                  </span>
                </div>
                <div className="status-row full-width">
                  <span className="label">{t('match.file_path')}</span>
                  <span className="value path">{track.path}</span>
                </div>
              </>
            )}
          </div>

          {track?.path && <FileTagsCard filePath={track.path} />}

          {match.confidence === 'medium' && confirmedPath !== track?.path && (
            <div className="alert alert-warning">
              <p>{t('match.confirm_medium')}</p>
              <button className="btn btn-primary" onClick={() => onConfirm(track?.path)}>
                {t('match.confirm_button')}
              </button>
            </div>
          )}

          {match.alternatives?.length > 0 && (
            <div className="alternatives">
              <h4>{t('match.alternatives')}</h4>
              <ul>
                {match.alternatives.map(alt => (
                  <li key={alt.path} className="alt-item">
                    <span className="alt-title">{alt.title}</span>
                    <span className="alt-artist muted"> — {alt.artist}</span>
                    <ConfidenceBadge confidence={alt.confidence} />
                    <LyricsStatusBadge status={alt.lyrics_status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      </div>
    </section>
  );
}
