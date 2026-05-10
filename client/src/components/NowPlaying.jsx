import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function NowPlaying({ data, onRefresh, onControl, onVolume, onMute, onSeek, onSettings }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('now-playing');

  const stateKey = {
    playing: 'now_playing.state_playing',
    paused:  'now_playing.state_paused',
    stopped: 'now_playing.state_stopped',
    loading: 'now_playing.state_loading',
  }[data?.state] || 'now_playing.state_stopped';

  const isPlaying = data?.state === 'playing';
  const progress = data?.duration_seconds
    ? Math.min(100, ((data.seek_position_seconds ?? 0) / data.duration_seconds) * 100)
    : 0;

  const loopLabel = {
    disabled: null,
    loop: t('now_playing.loop_all'),
    loop_one: t('now_playing.loop_one'),
  }[data?.loop];

  // Album art: prefer image_key, fall back to first artist image
  const artKey = data?.image_key || (data?.artist_image_keys?.[0] ?? null);
  const isArtistFallback = !data?.image_key && artKey;

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('section.now_playing')}</h2>
        <div className="card-header-actions">
          <button className="btn btn-ghost" onClick={onRefresh}>
            {t('now_playing.refresh')}
          </button>
          <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
            {collapsed ? '▶' : '▼'}
          </button>
        </div>
      </div>

      <div className="card-body">
      {!data ? (
        <p className="muted">{t('now_playing.no_track')}</p>
      ) : (
        <div className="now-playing-layout">

          {/* ── Top row: art + info ── */}
          <div className="now-playing-top">
            <div className="now-playing-art-wrap">
              {artKey ? (
                <img
                  className={`now-playing-art${isArtistFallback ? ' np-art-artist' : ''}`}
                  src={`/api/roon/image/${artKey}?w=120&h=120`}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="now-playing-art now-playing-art-placeholder">♫</div>
              )}
            </div>

            <div className="now-playing-info">
              <div className="track-title">{data.title || t('common.na')}</div>
              <div className="track-artist">{data.artist || t('common.na')}</div>
              <div className="track-album">{data.album || t('common.na')}</div>

              <div className="track-badges">
                <span className={`badge badge-sm ${isPlaying ? 'badge-success' : 'badge-neutral'}`}>
                  {t(stateKey)}
                </span>
                <span className="badge badge-sm badge-neutral">{data.zone_name}</span>
                {data.shuffle && (
                  <span className="badge badge-sm badge-info">{t('now_playing.shuffle')}</span>
                )}
                {loopLabel && (
                  <span className="badge badge-sm badge-info">↺ {loopLabel}</span>
                )}
                {data.auto_radio && (
                  <span className="badge badge-sm badge-neutral">{t('now_playing.auto_radio')}</span>
                )}
                {data.queue_items_remaining != null && (
                  <span className="badge badge-sm badge-neutral">
                    {t('now_playing.queue_remaining', { count: data.queue_items_remaining })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Progress bar (clickable for seek) ── */}
          {data.duration_seconds ? (
            <div className="np-progress-wrap">
              <div
                className={`np-progress-bar${onSeek && data.is_seek_allowed ? ' np-progress-seekable' : ''}`}
                onClick={onSeek && data.is_seek_allowed ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  onSeek('absolute', Math.round(ratio * data.duration_seconds));
                } : undefined}
                title={onSeek && data.is_seek_allowed ? t('now_playing.seek_hint') : undefined}
              >
                <div className="np-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="np-progress-times">
                <span>{formatTime(data.seek_position_seconds)}</span>
                <span>{formatTime(data.duration_seconds)}</span>
              </div>
            </div>
          ) : null}

          {/* ── Playback controls ── */}
          {onControl && (
            <div className="np-controls">
              <button
                className="btn np-ctrl-btn"
                onClick={() => onControl('previous')}
                disabled={!data.is_previous_allowed}
                title={t('now_playing.control_prev')}
              >⏮</button>
              <button
                className="btn np-ctrl-btn np-ctrl-main"
                onClick={() => onControl('playpause')}
                disabled={!data.is_play_allowed && !data.is_pause_allowed}
                title={isPlaying ? t('now_playing.control_pause') : t('now_playing.control_play')}
              >{isPlaying ? '⏸' : '▶'}</button>
              <button
                className="btn np-ctrl-btn"
                onClick={() => onControl('next')}
                disabled={!data.is_next_allowed}
                title={t('now_playing.control_next')}
              >⏭</button>
            </div>
          )}

          {/* ── Settings controls: shuffle / loop / auto_radio ── */}
          {onSettings && (
            <div className="np-settings-row">
              <button
                className={`btn btn-xs np-setting-btn${data.shuffle ? ' np-setting-on' : ''}`}
                onClick={() => onSettings({ shuffle: !data.shuffle })}
                title={t('now_playing.shuffle')}
              >🔀 {t('now_playing.shuffle')}</button>

              <button
                className={`btn btn-xs np-setting-btn${data.loop !== 'disabled' ? ' np-setting-on' : ''}`}
                onClick={() => {
                  const next = data.loop === 'disabled' ? 'loop' : data.loop === 'loop' ? 'loop_one' : 'disabled';
                  onSettings({ loop: next });
                }}
                title={t('now_playing.loop_cycle')}
              >
                {data.loop === 'loop_one' ? '🔂' : '🔁'}
                {' '}
                {data.loop === 'disabled' ? t('now_playing.loop_off') : data.loop === 'loop' ? t('now_playing.loop_all') : t('now_playing.loop_one')}
              </button>

              <button
                className={`btn btn-xs np-setting-btn${data.auto_radio ? ' np-setting-on' : ''}`}
                onClick={() => onSettings({ auto_radio: !data.auto_radio })}
                title={t('now_playing.auto_radio')}
              >📻 {t('now_playing.auto_radio')}</button>
            </div>
          )}

          {/* ── Volume per output (with master when ≥2 controllable) ── */}
          {(onVolume || onMute) && data.outputs?.length > 0 && (() => {
            const ctrl = data.outputs.filter(o => o.volume);
            const hasMaster = ctrl.length >= 2;

            // Master state
            const allMuted = hasMaster && ctrl.every(o => o.volume.is_muted);
            const anyMuted = hasMaster && ctrl.some(o => o.volume.is_muted);
            const masterPct = hasMaster
              ? Math.round(ctrl.reduce((sum, o) => sum + (o.volume.value - o.volume.min) / (o.volume.max - o.volume.min), 0) / ctrl.length * 100)
              : 0;
            const masterVal = hasMaster
              ? Math.round(ctrl.reduce((sum, o) => sum + o.volume.value, 0) / ctrl.length)
              : 0;

            const handleMasterVolume = (delta) => {
              if (!onVolume) return;
              ctrl.forEach(o => onVolume(o.output_id, 'relative', delta));
            };
            const handleMasterMute = () => {
              if (!onMute) return;
              const how = allMuted ? 'unmute' : 'mute';
              ctrl.forEach(o => onMute(o.output_id, how));
            };

            return (
            <div className="np-volumes">
              {hasMaster && (
                <div className="np-volume-row np-master-row">
                  <span className="np-volume-name np-master-label">{t('now_playing.master')}</span>
                  <div className="np-volume-ctrl">
                    <button
                      className="btn np-vol-btn"
                      onClick={() => handleMasterVolume(-5)}
                      title={t('now_playing.volume_down')}
                      disabled={!onVolume || allMuted}
                    >−</button>
                    <div className="np-volume-track">
                      <div className="np-volume-fill" style={{ width: `${masterPct}%` }} />
                      <span className="np-volume-val">
                        {allMuted ? '🔇' : anyMuted ? '~' + masterVal : masterVal}
                      </span>
                    </div>
                    <button
                      className="btn np-vol-btn"
                      onClick={() => handleMasterVolume(5)}
                      title={t('now_playing.volume_up')}
                      disabled={!onVolume || allMuted}
                    >+</button>
                    {onMute && (
                      <button
                        className={`btn np-vol-btn np-mute-btn${allMuted ? ' np-muted' : ''}`}
                        onClick={handleMasterMute}
                        title={t('now_playing.volume_mute')}
                      >{allMuted ? '🔇' : '🔊'}</button>
                    )}
                  </div>
                </div>
              )}
              {data.outputs.map(output => (
                output.volume ? (
                  <div key={output.output_id} className="np-volume-row">
                    <span className="np-volume-name">{output.display_name}</span>
                    <div className="np-volume-ctrl">
                      <button
                        className="btn np-vol-btn"
                        onClick={() => onVolume && onVolume(output.output_id, 'relative', -5)}
                        title={t('now_playing.volume_down')}
                        disabled={!onVolume || output.volume.is_muted || output.volume.value <= output.volume.min}
                      >−</button>
                      <div className="np-volume-track">
                        <div
                          className="np-volume-fill"
                          style={{ width: `${Math.round(((output.volume.value - output.volume.min) / (output.volume.max - output.volume.min)) * 100)}%` }}
                        />
                        <span className="np-volume-val">
                          {output.volume.is_muted ? '🔇' : output.volume.value}
                        </span>
                      </div>
                      <button
                        className="btn np-vol-btn"
                        onClick={() => onVolume && onVolume(output.output_id, 'relative', 5)}
                        title={t('now_playing.volume_up')}
                        disabled={!onVolume || output.volume.is_muted || output.volume.value >= output.volume.max}
                      >+</button>
                      {onMute && (
                        <button
                          className={`btn np-vol-btn np-mute-btn${output.volume.is_muted ? ' np-muted' : ''}`}
                          onClick={() => onMute(output.output_id, output.volume.is_muted ? 'unmute' : 'mute')}
                          title={t('now_playing.volume_mute')}
                        >{output.volume.is_muted ? '🔇' : '🔊'}</button>
                      )}
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          );
          })()}

        </div>
      )}
      </div>
    </section>
  );
}

