import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import SyncedLyrics from './SyncedLyrics.jsx';

/**
 * Full-screen lyrics view: big type over a blurred cover, transport at the bottom.
 * Used as an overlay from the lyrics stage (onClose set) and as the kiosk page
 * (onClose null, `headerExtra` holds the zone switch).
 *
 * Props:
 *   np            — now-playing state of the followed zone (or null)
 *   lyrics        — `lyrics` object from /api/lyrics/current (or null)
 *   message       — text shown instead of lyrics (loading, not found…)
 *   onSeekLine    — (seconds) => void; makes timed lines clickable
 *   onControl     — (action) => void; prev / playpause / next
 *   onClose       — closes the overlay (Esc too); omitted in kiosk mode
 *   headerExtra   — extra node in the header (kiosk zone switch)
 */
export default function LyricsFullscreen({
  np, lyrics, message, onSeekLine, onControl, onClose, headerExtra,
}) {
  const { t } = useTranslation();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!onClose) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const artKey = np?.image_key || np?.artist_image_keys?.[0] || null;
  const isPlaying = np?.state === 'playing';
  const progress = np?.duration_seconds
    ? Math.min(100, ((np.seek_position_seconds ?? 0) / np.duration_seconds) * 100)
    : 0;
  const showLyrics = lyrics?.found && lyrics.text;

  return (
    <div className="lyrics-fs" role="dialog" aria-modal={onClose ? 'true' : undefined} aria-label={t('stage.fullscreen')}>
      {artKey && (
        <div className="lyrics-fs-bg" style={{ backgroundImage: `url(/api/roon/image/${artKey}?w=300&h=300)` }} aria-hidden="true" />
      )}

      <header className="lyrics-fs-head">
        {artKey && <img className="lyrics-fs-cover" src={`/api/roon/image/${artKey}?w=160&h=160`} alt="" />}
        <div className="lyrics-fs-meta">
          <div className="lyrics-fs-title">{np?.title || t('now_playing.no_track')}</div>
          {np?.artist && <div className="lyrics-fs-artist">{np.artist}</div>}
          {np?.zone_name && <div className="lyrics-fs-zone">{np.zone_name}</div>}
        </div>
        <div className="lyrics-fs-head-actions">
          {headerExtra}
          {onClose && (
            <button ref={closeRef} type="button" className="lyrics-fs-btn" onClick={onClose} aria-label={t('common.close')} title={`${t('common.close')} (Esc)`}>
              ✕
            </button>
          )}
        </div>
      </header>

      <main className="lyrics-fs-body">
        {showLyrics ? (
          <SyncedLyrics
            key={`${lyrics.track_id}|${lyrics.lrclib_id}`}
            className="synced-lyrics--fs"
            lrcText={lyrics.text}
            seekSeconds={np?.seek_position_seconds ?? 0}
            isPlaying={isPlaying}
            alwaysSync
            offsetMs={lyrics.offset_ms || 0}
            onLineClick={np?.is_seek_allowed ? onSeekLine : null}
          />
        ) : (
          <p className="lyrics-fs-message">{message}</p>
        )}
      </main>

      <footer className="lyrics-fs-foot">
        <div className="lyrics-fs-progress" aria-hidden="true">
          <div className="lyrics-fs-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        {np && onControl && (
          <div className="lyrics-fs-transport">
            <button type="button" className="lyrics-fs-btn" onClick={() => onControl('previous')} disabled={!np.is_previous_allowed} aria-label={t('now_playing.control_prev')}>⏮</button>
            <button type="button" className="lyrics-fs-btn lyrics-fs-btn--main" onClick={() => onControl('playpause')} disabled={!np.is_play_allowed && !np.is_pause_allowed} aria-label={isPlaying ? t('now_playing.control_pause') : t('now_playing.control_play')}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button type="button" className="lyrics-fs-btn" onClick={() => onControl('next')} disabled={!np.is_next_allowed} aria-label={t('now_playing.control_next')}>⏭</button>
          </div>
        )}
      </footer>
    </div>
  );
}
