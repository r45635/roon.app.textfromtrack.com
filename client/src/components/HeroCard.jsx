import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import FileTagsCard from './FileTagsCard.jsx';
import LyricsSection from './LyricsSection.jsx';

const EMBED_SUPPORTED_EXTS = ['.mp3', '.flac'];

function fmt(seconds) {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ConfidencePill({ confidence }) {
  const { t } = useTranslation();
  const tone = { high: 'signal', medium: 'amber', low: 'error', none: '' }[confidence] || '';
  return (
    <span className={`tft-pill${tone ? ` ${tone}` : ''}`}>
      {tone && <span className="pill-dot" />}
      {t(`match.confidence_${confidence}`, confidence)}
    </span>
  );
}

function LyricsPill({ status }) {
  const { t } = useTranslation();
  const tone = {
    HAS_LRC_FILE: 'signal',
    HAS_EMBEDDED_LYRICS: '',
    HAS_CACHED_LYRICS: 'signal',
    NO_LOCAL_LYRICS: 'amber',
    UNKNOWN: '',
  }[status] || '';
  return (
    <span className={`tft-pill${tone ? ` ${tone}` : ''}`}>
      {t(`lyrics_status.${status}`, status)}
    </span>
  );
}

function AltMeta({ duration_seconds, sample_rate_hz, bits_per_sample, lossless }) {
  const parts = [];
  if (duration_seconds != null) parts.push(fmt(duration_seconds));
  if (sample_rate_hz != null) {
    const k = sample_rate_hz / 1000;
    parts.push((Number.isInteger(k) ? k : k.toFixed(1)) + 'kHz');
  }
  if (bits_per_sample != null) parts.push(bits_per_sample + 'bit');
  if (lossless) parts.push('Lossless');
  if (!parts.length) return null;
  return <div className="tft-alt-meta">{parts.map((p, i) => <span key={i}>{p}</span>)}</div>;
}

function ScoreChip({ label, points, max, hint }) {
  let cls = 'badge badge-sm badge-neutral';
  if (points > 0 && points >= max) cls = 'badge badge-sm badge-success';
  else if (points > 0) cls = 'badge badge-sm badge-warning';
  const title = hint ? `${label}: ${points}/${max} — ${hint}` : `${label}: ${points}/${max}`;
  return (
    <span className={cls} title={title}>
      {label} {points}/{max}
    </span>
  );
}

export default function HeroCard({
  nowPlaying,
  matchData,
  tftAccount,
  onControl,
  onVolume,
  onMute,
  onSeek,
  onSettings,
  onGenerated,
  onSearch,
  volumeStep = 1,
  onZonePillClick,
}) {
  const { t } = useTranslation();

  // ── UI state ────────────────────────────────────────────────────────────────
  const [altOpen, setAltOpen] = useState(false);
  const [confirmedPath, setConfirmedPath] = useState(null);
  const [altFormatCache, setAltFormatCache] = useState({});
  const [tagsRefreshKey, setTagsRefreshKey] = useState(0);
  const [volDetailOpen, setVolDetailOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const prevVolumeRef = useRef(null);
  const [autoSync, setAutoSync] = useState(true);

  // ── Title / Artist / Album marquee ──────────────────────────────────────────
  const titleRef = useRef(null);
  const artistRef = useRef(null);
  const albumRef = useRef(null);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const [artistOverflows, setArtistOverflows] = useState(false);
  const [albumOverflows, setAlbumOverflows] = useState(false);

  const checkMarquee = (el, setter) => {
    if (!el) return;
    const ov = el.scrollWidth > el.clientWidth + 2;
    setter(ov);
    if (ov) el.style.setProperty('--marquee-offset', `${-(el.scrollWidth - el.clientWidth)}px`);
  };

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const check = () => checkMarquee(el, setTitleOverflows);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nowPlaying?.title]);

  useEffect(() => {
    const checkAll = () => {
      checkMarquee(artistRef.current, setArtistOverflows);
      checkMarquee(albumRef.current, setAlbumOverflows);
    };
    checkAll();
    const ro = new ResizeObserver(checkAll);
    if (artistRef.current) ro.observe(artistRef.current);
    if (albumRef.current) ro.observe(albumRef.current);
    return () => ro.disconnect();
  }, [nowPlaying?.artist, nowPlaying?.album, nowPlaying?.year]);

  // Freeze matchData when Auto Sync is off so the Local File Match strip
  // doesn't jump to the new track while the user is editing lyrics.
  const [frozenMatchData, setFrozenMatchData] = useState(matchData);
  useEffect(() => {
    if (autoSync) setFrozenMatchData(matchData);
  }, [matchData, autoSync]);

  // ── Volume drag helper ───────────────────────────────────────────────────────
  function startVolumeDrag(e, outputIds, vMax) {
    e.preventDefault();
    const bar = e.currentTarget;
    let lastVal = -1;
    const apply = (clientX) => {
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const val = Math.round(pct * vMax);
      if (val === lastVal) return;
      lastVal = val;
      outputIds.forEach(id => onVolume?.(id, 'absolute', val));
    };
    apply(e.clientX);
    const onMove = (me) => apply(me.clientX);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  // Reset alternative selection when track changes
  const trackKey = nowPlaying?.now_playing?.one_line?.line1 ?? nowPlaying?.zone_id;
  useEffect(() => {
    setAltOpen(false);
    setConfirmedPath(null);
    setAltFormatCache({});
    setIsMuted(false);
  }, [trackKey]);

  // ── Derived values ───────────────────────────────────────────────────────────
  const np = nowPlaying;
  const isPlaying = np?.state === 'playing';
  const progress = np?.duration_seconds
    ? Math.min(100, ((np.seek_position_seconds ?? 0) / np.duration_seconds) * 100)
    : 0;
  const artKey = np?.image_key || (np?.artist_image_keys?.[0] ?? null);

  const match = frozenMatchData?.match;
  const matchedPath = match?.track?.path || '';
  const effectivePath = confirmedPath || matchedPath;

  // When the user picks an alternative, use its data for the strip display
  const selectedAlt = confirmedPath && confirmedPath !== matchedPath
    ? match?.alternatives?.find(a => a.path === confirmedPath)
    : null;
  const displayConfidence = selectedAlt ? selectedAlt.confidence : match?.confidence;
  const displayScore = selectedAlt ? selectedAlt.score : match?.score;
  // Merge lazy-loaded format data on top of the alt (fields may be null in the index)
  const displayTrack = selectedAlt
    ? { ...selectedAlt, ...(altFormatCache[selectedAlt.path] ?? {}) }
    : match?.track;

  // Lazy-fetch format fields for the selected alt when they're missing
  useEffect(() => {
    if (!selectedAlt) return;
    if (selectedAlt.sample_rate_hz != null) return; // already in index
    if (altFormatCache[selectedAlt.path]) return;   // already fetched
    fetch(`/api/music/file-format?path=${encodeURIComponent(selectedAlt.path)}`)
      .then(r => r.json())
      .then(d => { if (d.success) setAltFormatCache(prev => ({ ...prev, [selectedAlt.path]: d })); })
      .catch(() => {});
  }, [selectedAlt, altFormatCache]);

  const lyricsStatus = displayTrack?.lyrics_status;
  const lyricsExist = lyricsStatus === 'HAS_LRC_FILE' || lyricsStatus === 'HAS_EMBEDDED_LYRICS' || lyricsStatus === 'HAS_CACHED_LYRICS';
  const effectiveFilename = effectivePath ? effectivePath.split('/').pop() : '';
  const effectiveDir = effectivePath ? effectivePath.slice(0, effectivePath.lastIndexOf('/') + 1) : '';
  const matchedExt = matchedPath ? matchedPath.slice(matchedPath.lastIndexOf('.')).toLowerCase() : '';
  const embedSupported = !matchedPath || EMBED_SUPPORTED_EXTS.includes(matchedExt);

  // Volume: collect all outputs with volume data
  const firstOutput = np?.outputs?.[0];
  const volumeVal = firstOutput?.volume?.value ?? null;
  const volumeOutputs = (np?.outputs ?? []).filter(o => o.volume != null);
  const multiVolume = volumeOutputs.length > 1;

  const loopLabel = {
    loop: t('now_playing.loop_all'),
    loop_one: t('now_playing.loop_one'),
  }[np?.loop] ?? null;

  const scoreFields = [
    { key: 'title',    label: t('match.detail_title',    'Title'),  hint: t('match.hint_title',    'Titre · exact=50, similaire ≥0.85=35, ≥0.70=20 · max 50') },
    { key: 'artist',   label: t('match.detail_artist',   'Artist'), hint: t('match.hint_artist',   'Artiste · exact=30, similaire ≥0.85=21, ≥0.70=12 · max 30') },
    { key: 'album',    label: t('match.detail_album',    'Album'),  hint: t('match.hint_album',    'Album · exact=20, similaire ≥0.85=14, ≥0.70=8 · max 20') },
    { key: 'duration', label: t('match.detail_duration', 'Dur.'),   hint: t('match.hint_duration', 'Durée · ≤2s=20, ≤5s=10 · max 20') },
    { key: 'filename', label: t('match.detail_filename', 'File'),   hint: t('match.hint_filename', 'Nom de fichier contient le titre · max 10') },
    { key: 'isrc',     label: 'ISRC',                                hint: t('match.hint_isrc',     'International Standard Recording Code · correspondance exacte · max 60') },
  ];

  return (
    <section className="tft-hero">

      {/* ═══ NOW PLAYING STRIP ══════════════════════════════════════════════════ */}
      <div className="tft-np">

        {/* ── Pills row — full width ─────────────────────────────────────────── */}
        <div className="tft-np-pills">
          {np && (
            <span
              className={`tft-pill${isPlaying ? ' signal' : ''}`}
              onClick={isPlaying ? onZonePillClick : undefined}
              style={isPlaying ? { cursor: 'pointer' } : undefined}
            >
              {isPlaying && <span className="pill-dot" />}
              {np.state === 'playing'
                ? `${t('now_playing.state_playing')} · ${np.zone_name}`
                : np.state === 'paused'
                ? t('now_playing.state_paused')
                : t('now_playing.state_stopped')}
            </span>
          )}
          {np?.auto_radio && <span className="tft-pill">{t('now_playing.auto_radio')}</span>}
          <label className="tft-autosync-label">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={e => setAutoSync(e.target.checked)}
              aria-label={t('now_playing.auto_sync', 'Auto Sync')}
            />
            {t('now_playing.auto_sync', 'Auto Sync')}
          </label>
        </div>

        {/* ── Cover ─────────────────────────────────────────────────────────── */}
        <div className="tft-np-cover">
          {artKey ? (
            <img
              className="tft-album-art"
              src={`/api/roon/image/${artKey}?w=440&h=440`}
              alt=""
              loading="lazy"
            />
          ) : (
            <div className="tft-album-art-placeholder">♫</div>
          )}
        </div>

        {/* ── Main column ───────────────────────────────────────────────────── */}
        <div className="tft-np-main">

          {/* Track meta */}
          <div className="tft-track-meta">
            <h1 ref={titleRef} className={`tft-np-title${titleOverflows ? ' is-scrolling' : ''}`}>
              <span className="tft-np-title-text">{np?.title || t('now_playing.no_track')}</span>
            </h1>
            {np && <>
              {onSearch && np.artist
                ? <div ref={artistRef} className={`tft-np-artist${artistOverflows ? ' is-scrolling' : ''}`}>
                    <span className="tft-np-artist-inner">
                      {np.artist.split('/').map((a, i, arr) => (
                        <React.Fragment key={i}>
                          <button type="button" className="tft-search-link tft-np-artist-part" onClick={() => onSearch(a.trim())}>{a.trim()}</button>
                          {i < arr.length - 1 && <span className="tft-np-artist-sep"> / </span>}
                        </React.Fragment>
                      ))}
                    </span>
                  </div>
                : <div ref={artistRef} className={`tft-np-artist${artistOverflows ? ' is-scrolling' : ''}`}>
                    <span className="tft-np-artist-inner">{np?.artist}</span>
                  </div>
              }
              {onSearch && np.album
                ? <button ref={albumRef} type="button" className={`tft-np-album tft-mono tft-search-link${albumOverflows ? ' is-scrolling' : ''}`} onClick={() => onSearch(np.album)}>
                    <span className="tft-np-album-text">{np.album}{np.year ? ` · ${np.year}` : ''}</span>
                  </button>
                : <div ref={albumRef} className={`tft-np-album tft-mono${albumOverflows ? ' is-scrolling' : ''}`}>
                    <span className="tft-np-album-text">{np?.album}{np?.year ? ` · ${np.year}` : ''}</span>
                  </div>
              }
            </>}
          </div>

          {/* Progress */}
          {np?.duration_seconds ? (
            <div className="tft-progress-wrap">
              <div
                className={`tft-progress-bar${onSeek && np.is_seek_allowed ? ' np-progress-seekable' : ''}`}
                onClick={onSeek && np.is_seek_allowed ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  onSeek('absolute', Math.round(ratio * np.duration_seconds));
                } : undefined}
              >
                <div className="tft-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="tft-progress-times">
                <span className="t-current">{fmt(np.seek_position_seconds)}</span>
                <span className="t-total">{fmt(np.duration_seconds)}</span>
              </div>
            </div>
          ) : null}

          {/* Volume */}
          <div className="tft-volume-card">
            {!multiVolume && volumeVal != null && firstOutput && (() => {
              const vMax = firstOutput.volume?.soft_limit ?? firstOutput.volume?.max ?? 100;
              const vPct = Math.round((volumeVal / vMax) * 100);
              return (
                <div className="tft-volume">
                  <button
                    type="button"
                    className="tft-volume-mute-btn"
                    aria-label={t('now_playing.volume_mute')}
                    onClick={() => {
                      if (!isMuted) {
                        prevVolumeRef.current = volumeVal;
                        setIsMuted(true);
                        onVolume?.(firstOutput.output_id, 'absolute', 0);
                      } else {
                        setIsMuted(false);
                        onVolume?.(firstOutput.output_id, 'absolute', prevVolumeRef.current ?? 50);
                      }
                    }}
                  >{isMuted ? '🔇' : '🔊'}</button>
                  <div
                    className="tft-volume-bar tft-volume-bar--interactive"
                    onMouseDown={(e) => startVolumeDrag(e, [firstOutput.output_id], vMax)}
                  >
                    <div className="tft-volume-fill" style={{ width: `${vPct}%` }} />
                  </div>
                  <div className="tft-volume-val tft-mono">{volumeVal}</div>
                  <button
                    type="button"
                    className="tft-round-btn tft-round-btn--small"
                    aria-label={t('now_playing.vol_down', 'Decrease volume')}
                    onClick={() => onVolume?.(firstOutput.output_id, 'relative', -volumeStep)}
                  >−</button>
                  <button
                    type="button"
                    className="tft-round-btn tft-round-btn--small"
                    aria-label={t('now_playing.vol_up', 'Increase volume')}
                    onClick={() => onVolume?.(firstOutput.output_id, 'relative', volumeStep)}
                  >+</button>
                </div>
              );
            })()}
            {multiVolume && (() => {
              const avgVal = Math.round(volumeOutputs.reduce((s, o) => s + o.volume.value, 0) / volumeOutputs.length);
              const globalMax = Math.max(...volumeOutputs.map(o => o.volume.soft_limit ?? o.volume.max ?? 100));
              const avgPct = Math.round((avgVal / globalMax) * 100);
              return (
                <div className="tft-volume-group">
                  <div className="tft-volume">
                    <button
                      type="button"
                      className="tft-volume-detail-toggle"
                      onClick={() => setVolDetailOpen(v => !v)}
                      title={volDetailOpen ? 'Masquer le détail' : 'Voir le détail par enceinte'}
                    >{volDetailOpen ? '▾' : '▸'}</button>
                    <button
                      type="button"
                      className="tft-volume-mute-btn"
                      aria-label={t('now_playing.volume_mute')}
                      onClick={() => {
                        if (!isMuted) {
                          prevVolumeRef.current = avgVal;
                          setIsMuted(true);
                          volumeOutputs.forEach(o => onVolume?.(o.output_id, 'absolute', 0));
                        } else {
                          setIsMuted(false);
                          volumeOutputs.forEach(o => onVolume?.(o.output_id, 'absolute', prevVolumeRef.current ?? 50));
                        }
                      }}
                    >{isMuted ? '🔇' : '🔊'}</button>
                    <div
                      className="tft-volume-bar tft-volume-bar--interactive"
                      onMouseDown={(e) => startVolumeDrag(e, volumeOutputs.map(o => o.output_id), globalMax)}
                    >
                      <div className="tft-volume-fill" style={{ width: `${avgPct}%` }} />
                    </div>
                    <div className="tft-volume-val tft-mono">{avgVal}</div>
                    <button
                      type="button"
                      className="tft-round-btn tft-round-btn--small"
                      aria-label={t('now_playing.vol_down', 'Decrease volume')}
                      onClick={() => volumeOutputs.forEach(o => onVolume?.(o.output_id, 'relative', -volumeStep))}
                    >−</button>
                    <button
                      type="button"
                      className="tft-round-btn tft-round-btn--small"
                      aria-label={t('now_playing.vol_up', 'Increase volume')}
                      onClick={() => volumeOutputs.forEach(o => onVolume?.(o.output_id, 'relative', volumeStep))}
                    >+</button>
                  </div>
                  {volDetailOpen && (
                    <div className="tft-volume-rows">
                      {volumeOutputs.map(o => {
                        const vMax = o.volume.soft_limit ?? o.volume.max ?? 100;
                        const vPct = Math.round((o.volume.value / vMax) * 100);
                        return (
                          <div className="tft-volume-row" key={o.output_id}>
                            <span className="tft-volume-name tft-mono" title={o.display_name}>
                              {o.display_name.split(' ').pop()}
                            </span>
                            <div
                              className="tft-volume-bar tft-volume-bar--interactive"
                              onMouseDown={(e) => startVolumeDrag(e, [o.output_id], vMax)}
                            >
                              <div className="tft-volume-fill" style={{ width: `${vPct}%` }} />
                            </div>
                            <div className="tft-volume-val tft-mono">{o.volume.value}</div>
                            <button
                              type="button"
                              className="tft-round-btn tft-round-btn--small"
                              aria-label={t('now_playing.vol_down', 'Decrease volume')}
                              onClick={() => onVolume?.(o.output_id, 'relative', -volumeStep)}
                            >−</button>
                            <button
                              type="button"
                              className="tft-round-btn tft-round-btn--small"
                              aria-label={t('now_playing.vol_up', 'Increase volume')}
                              onClick={() => onVolume?.(o.output_id, 'relative', volumeStep)}
                            >+</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

        </div>{/* end .tft-np-main */}

        {/* ── Side — transport controls ──────────────────────────────────── */}
        <aside className="tft-np-side">
          <div className="tft-main-controls-row">
            {np && (onControl || onSettings) && (
              <div className="tft-transport">
                {onSettings && (
                  <button
                    type="button"
                    className={`tft-round-btn tft-round-btn--small${np.shuffle ? ' active' : ''}`}
                    aria-label={t('now_playing.shuffle', 'Toggle shuffle')}
                    onClick={() => onSettings({ shuffle: !np.shuffle })}
                  >🔀</button>
                )}
                {onControl && (
                  <>
                    <button
                      type="button"
                      className="tft-round-btn tft-round-btn--small"
                      aria-label={t('now_playing.previous', 'Previous track')}
                      onClick={() => onControl('previous')}
                      disabled={!np.is_previous_allowed}
                    >⏮</button>
                    <button
                      type="button"
                      className="tft-round-btn tft-round-btn--primary"
                      aria-label={isPlaying ? t('now_playing.pause', 'Pause') : t('now_playing.play', 'Play')}
                      onClick={() => onControl('playpause')}
                      disabled={!np.is_play_allowed && !np.is_pause_allowed}
                    >{isPlaying ? '⏸' : '▶'}</button>
                    <button
                      type="button"
                      className="tft-round-btn tft-round-btn--small"
                      aria-label={t('now_playing.next', 'Next track')}
                      onClick={() => onControl('next')}
                      disabled={!np.is_next_allowed}
                    >⏭</button>
                  </>
                )}
                {onSettings && (
                  <button
                    type="button"
                    className={`tft-round-btn tft-round-btn--small${np.loop !== 'disabled' ? ' active' : ''}`}
                    aria-label={t('now_playing.loop', 'Toggle repeat')}
                    onClick={() => {
                      const next = np.loop === 'disabled' ? 'loop' : np.loop === 'loop' ? 'loop_one' : 'disabled';
                      onSettings({ loop: next });
                    }}
                  >🔁</button>
                )}
              </div>
            )}
          </div>
        </aside>

      </div>

      {/* ═══ LOCAL MATCH STRIP ══════════════════════════════════════════════════ */}
      <div className={`tft-match-strip${!match?.matched ? ' no-match' : ''}`}>
        {!match?.matched ? (
          <span className="tft-mono">{t('match.no_match')}</span>
        ) : (
          <div className="tft-match-meta">
            <div className="tft-np-pills">
              <span className="tft-eyebrow" style={{ marginRight: 8 }}>{t('section.local_match', 'Local match')}</span>
              <ConfidencePill confidence={displayConfidence} />
              {lyricsStatus && <LyricsPill status={lyricsStatus} />}
              {displayScore != null && (
                <span className="tft-pill tft-mono">{displayScore} pts</span>
              )}
              {displayTrack && (() => {
                const tr = displayTrack;
                const fmtParts = [];
                if (tr.sample_rate_hz  != null) fmtParts.push(`${Math.round(tr.sample_rate_hz / 1000)}kHz`);
                if (tr.bits_per_sample != null) fmtParts.push(`${tr.bits_per_sample}bits`);
                const audioFmt = fmtParts.join('-');
                const dur  = tr.duration_seconds != null ? fmt(tr.duration_seconds) : null;
                const size = tr.size_bytes       != null ? `${(tr.size_bytes / 1024 / 1024).toFixed(1)}MB` : null;
                return (
                  <>
                    {audioFmt && <span className="tft-pill tft-mono">{audioFmt}</span>}
                    {tr.lossless && <span className="tft-pill sky tft-mono">Lossless</span>}
                    {dur  && <span className="tft-pill tft-mono">{dur}</span>}
                    {size && <span className="tft-pill tft-mono">{size}</span>}
                  </>
                );
              })()}
            </div>
            {effectiveFilename && (
              <div className="tft-match-filename">{effectiveFilename}</div>
            )}
            <div className="tft-match-path">
              <button
                className="tft-folder-btn"
                title="Ouvrir le dossier dans le Finder"
                onClick={e => { e.stopPropagation(); fetch(`/api/music/open-folder?path=${encodeURIComponent(effectivePath)}`); }}
              >📂</button>
              {effectiveDir}
            </div>
            {!confirmedPath && match.score_detail && (
              <div className="tft-match-chips">
                {scoreFields.map(({ key, label, hint }) => {
                  const d = match.score_detail[key];
                  if (!d) return null;
                  return <ScoreChip key={key} label={label} points={d.points} max={d.max} hint={hint} />;
                })}
              </div>
            )}
            {match.alternatives?.length > 0 && (
              <div className="tft-match-alts">
                <button
                  className="tft-alts-toggle"
                  onClick={() => setAltOpen(o => !o)}
                  aria-expanded={altOpen}
                >
                  <span className="tft-alts-chevron">{altOpen ? '▼' : '▶'}</span>
                  {match.alternatives.length} {t('match.other_candidates', 'autre(s) candidat(s)')}
                  {confirmedPath && confirmedPath !== matchedPath && (
                    <span className="tft-alts-override-badge">{t('match.override_active', 'sélection manuelle')}</span>
                  )}
                </button>
                {altOpen && (
                  <ul className="tft-alts-list">
                    <li
                      className={`tft-alt-item${!confirmedPath || confirmedPath === matchedPath ? ' selected' : ''}`}
                      onClick={() => setConfirmedPath(null)}
                    >
                      <ConfidencePill confidence={match.confidence} />
                      <span className="tft-alt-score">{match.score} pts</span>
                      <span className="tft-alt-name">{match.track?.title} — {match.track?.artist}</span>
                      <span className="tft-alt-path">{matchedPath.split('/').pop()}</span>
                      <AltMeta {...match.track} />
                    </li>
                    {match.alternatives.map(alt => (
                      <li
                        key={alt.path}
                        className={`tft-alt-item${confirmedPath === alt.path ? ' selected' : ''}`}
                        onClick={() => setConfirmedPath(alt.path)}
                      >
                        <ConfidencePill confidence={alt.confidence} />
                        <span className="tft-alt-score">{alt.score} pts</span>
                        <span className="tft-alt-name">{alt.title} — {alt.artist}</span>
                        <span className="tft-alt-path">{alt.path.split('/').pop()}</span>
                        <AltMeta {...alt} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ FILE TAGS ═══════════════════════════════════════════════════════════ */}
      {match?.matched && effectivePath && (
        <div style={{ padding: '0 28px 4px' }}>
          <FileTagsCard filePath={effectivePath} refreshKey={tagsRefreshKey} nowPlaying={np} />
        </div>
      )}

      {/* ═══ LYRICS PROVIDERS ════════════════════════════════════════════════ */}
      <LyricsSection
        nowPlaying={np}
        effectivePath={effectivePath || null}
        confirmedPath={confirmedPath}
        lyricsExist={lyricsExist}
        tftAccount={tftAccount}
        matchConfidence={match?.confidence ?? null}
        onTagsRefresh={() => setTagsRefreshKey(k => k + 1)}
        autoSync={autoSync}
        onAutoSyncChange={setAutoSync}
      />
    </section>
  );
}
