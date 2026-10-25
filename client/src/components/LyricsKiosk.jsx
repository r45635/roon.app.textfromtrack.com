import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import LyricsFullscreen from './LyricsFullscreen.jsx';
import { useTrackLyrics } from '../hooks/useTrackLyrics.js';
import { lrclibProblem } from '../lib/errors.js';

const POLL_MS = 1000;

/** Zone id from a hash like "#/lyrics?zone=1601…". */
function zoneFromHash() {
  const q = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(q).get('zone');
}

function setZoneInHash(zoneId) {
  window.location.hash = zoneId ? `#/lyrics?zone=${encodeURIComponent(zoneId)}` : '#/lyrics';
}

/** Keep the screen awake while the page is visible (tablet / TV display). */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch { /* denied or unsupported: the display may sleep */ }
      if (cancelled && lock) lock.release().catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) lock.release().catch(() => {});
    };
  }, []);
}

/**
 * Lyrics display page for a tablet or TV: one zone, full screen, no settings.
 * Each kiosk follows its own zone (?zone=) without changing the main UI's zone.
 */
export default function LyricsKiosk() {
  const { t } = useTranslation();
  const [zoneId, setZoneId] = useState(zoneFromHash);
  const [zones, setZones] = useState([]);
  const [np, setNp] = useState(null);
  const [offline, setOffline] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(!zoneFromHash());

  useWakeLock();

  useEffect(() => {
    const onHash = () => setZoneId(zoneFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const qs = zoneId ? `?zone_id=${encodeURIComponent(zoneId)}` : '';
        const res = await fetch(`/api/roon/now-playing${qs}`);
        const data = await res.json().catch(() => null);
        if (stopped) return;
        setOffline(false);
        setNp(res.ok ? data?.now_playing ?? null : null);
      } catch {
        if (!stopped) setOffline(true);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [zoneId]);

  useEffect(() => {
    if (!pickerOpen) return;
    fetch('/api/roon/zones').then(r => r.json()).then(d => setZones(d.zones || [])).catch(() => setZones([]));
  }, [pickerOpen]);

  const { status, data } = useTrackLyrics(np);
  const lyrics = data?.lyrics || null;

  async function post(url, body) {
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch { setOffline(true); }
  }

  const message = offline ? t('status.backend_offline')
    : !np ? t('kiosk.idle')
    : status === 'loading' ? t('stage.loading')
    : lyrics?.instrumental ? t('stage.instrumental')
    : lyrics?.error ? lrclibProblem(lyrics.error)
    : t('stage.not_found_short');

  const zoneSwitch = (
    <button type="button" className="lyrics-fs-btn lyrics-fs-btn--text" onClick={() => setPickerOpen(true)}>
      {t('kiosk.change_zone')}
    </button>
  );

  return (
    <>
      <LyricsFullscreen
        np={np}
        lyrics={lyrics}
        message={message}
        onSeekLine={np?.zone_id ? (secs) => post('/api/roon/seek', { zone_id: np.zone_id, how: 'absolute', seconds: Math.max(0, secs) }) : null}
        onControl={np?.zone_id ? (action) => post('/api/roon/control', { zone_id: np.zone_id, action }) : null}
        headerExtra={zoneSwitch}
      />
      {pickerOpen && (
        <div className="kiosk-picker" role="dialog" aria-modal="true" aria-label={t('kiosk.pick_zone')}>
          <div className="kiosk-picker-card">
            <h2>{t('kiosk.pick_zone')}</h2>
            <ul>
              <li>
                <button type="button" className={!zoneId ? 'selected' : ''} onClick={() => { setZoneInHash(null); setPickerOpen(false); }}>
                  {t('kiosk.follow_active')}
                </button>
              </li>
              {zones.map(z => (
                <li key={z.zone_id}>
                  <button type="button" className={z.zone_id === zoneId ? 'selected' : ''} onClick={() => { setZoneInHash(z.zone_id); setPickerOpen(false); }}>
                    <span>{z.display_name}</span>
                    {z.now_playing_title && <span className="kiosk-picker-np">{z.now_playing_title}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <a className="kiosk-picker-back" href="#/">{t('kiosk.back_to_app')}</a>
          </div>
        </div>
      )}
    </>
  );
}
