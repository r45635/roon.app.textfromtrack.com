import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';
import FileTagsCard from './FileTagsCard.jsx';

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
