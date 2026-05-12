import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import HeroCard from './components/HeroCard.jsx';
import RoonStatus from './components/RoonStatus.jsx';
import ZoneSelector from './components/ZoneSelector.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import JobHistory from './components/JobHistory.jsx';
import LibrarySettings from './components/LibrarySettings.jsx';
import AppPrefs from './components/AppPrefs.jsx';
import TftApiKey from './components/TftApiKey.jsx';
import FilesManagement from './components/FilesManagement.jsx';
import { useAppPrefs } from './hooks/useAppPrefs.js';

const JOBS_POLL_MS = 5000;

export default function App() {
  const { i18n, t } = useTranslation();
  const [prefs, setPref] = useAppPrefs();
  const roonPollMsRef = useRef(prefs.roonPollMs);
  useEffect(() => { roonPollMsRef.current = prefs.roonPollMs; }, [prefs.roonPollMs]);

  const [roonStatus, setRoonStatus] = useState(null);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [zones, setZones] = useState([]);
  const [matchData, setMatchData] = useState(null);
  const [indexStatus, setIndexStatus] = useState(null);
  const [tftAccount, setTftAccount] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [confirmedPath, setConfirmedPath] = useState(null);
  const prevTrackKeyRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roonModalOpen, setRoonModalOpen] = useState(false);
  const [searchTrigger, setSearchTrigger] = useState(null);
  const [backendOnline, setBackendOnline] = useState(true);
  const backendOnlineRef = useRef(true);
  const [refreshingCredits, setRefreshingCredits] = useState(false);

  // ── API helpers ──────────────────────────────────────────────────────────────

  async function apiFetch(endpoint) {
    try {
      const res = await fetch(endpoint);
      // 502/503/504 = proxy/gateway error — backend process is down
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        setBackendOnline(false);
        backendOnlineRef.current = false;
        return null;
      }
      setBackendOnline(true);
      backendOnlineRef.current = true;
      if (!res.ok) return null;
      return res.json().catch(() => null);
    } catch {
      setBackendOnline(false);
      backendOnlineRef.current = false;
      return null;
    }
  }

  // ── Fetch functions ──────────────────────────────────────────────────────────

  const fetchRoonStatus = useCallback(async () => {
    const data = await apiFetch('/api/roon/status');
    if (data) setRoonStatus(data);
  }, []);

  const fetchNowPlaying = useCallback(async () => {
    const data = await apiFetch('/api/roon/now-playing');
    setNowPlaying(data?.now_playing ?? null);
  }, []);

  const fetchZones = useCallback(async () => {
    const data = await apiFetch('/api/roon/zones');
    if (data?.zones) setZones(data.zones);
  }, []);

  const fetchMatch = useCallback(async () => {
    const data = await apiFetch('/api/music/match-current');
    if (data?.success) setMatchData(data);
    else setMatchData(null);
  }, []);

  const fetchIndexStatus = useCallback(async () => {
    const data = await apiFetch('/api/music/index/status');
    if (data) setIndexStatus(data);
  }, []);

  const fetchTftAccount = useCallback(async () => {
    const data = await apiFetch('/api/tft/me');
    if (data) setTftAccount({ token_valid: data.token_valid !== false, ...data });
  }, []);

  const refreshTftCredits = useCallback(async () => {
    if (refreshingCredits) return;
    setRefreshingCredits(true);
    try { await fetchTftAccount(); } finally { setRefreshingCredits(false); }
  }, [fetchTftAccount, refreshingCredits]);

  const fetchJobs = useCallback(async () => {
    const data = await apiFetch('/api/tft/jobs?limit=20');
    if (data?.success) setJobs(data.jobs);
  }, []);

  // ── Scan library ──────────────────────────────────────────────────────────────

  async function handleScan() {
    await fetch('/api/music/index/rescan', { method: 'POST' });
    setIndexStatus(s => s ? { ...s, scan_in_progress: true } : null);
    // Poll index status until scan finishes
    const interval = setInterval(async () => {
      const data = await apiFetch('/api/music/index/status');
      if (data) {
        setIndexStatus(data);
        if (!data.scan_in_progress) clearInterval(interval);
      }
    }, 2000);
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchRoonStatus();
    fetchNowPlaying();
    fetchZones();
    fetchIndexStatus();
    fetchTftAccount();
    fetchJobs();

    // Continuous polling — tick every 500 ms, actual fetch rate governed by roonPollMsRef.
    // When backend is offline, back off to 15 s (health-check only) to avoid request pile-up.
    const OFFLINE_BACKOFF_MS = 15_000;
    let lastRoonFetch = Date.now();
    let roonFetching = false;
    const roonInterval = setInterval(async () => {
      if (roonFetching) return; // prevent overlapping polls
      const pollMs = backendOnlineRef.current ? roonPollMsRef.current : OFFLINE_BACKOFF_MS;
      if (Date.now() - lastRoonFetch < pollMs) return;
      lastRoonFetch = Date.now();
      roonFetching = true;
      try {
        await fetchRoonStatus();
        if (backendOnlineRef.current) {
          await fetchNowPlaying();
          await fetchZones();
        }
      } finally {
        roonFetching = false;
      }
    }, 500);

    let jobsFetching = false;
    const jobsInterval = setInterval(async () => {
      if (jobsFetching || !backendOnlineRef.current) return;
      jobsFetching = true;
      try { await fetchJobs(); } finally { jobsFetching = false; }
    }, JOBS_POLL_MS);

    return () => {
      clearInterval(roonInterval);
      clearInterval(jobsInterval);
    };
  }, [fetchRoonStatus, fetchNowPlaying, fetchZones, fetchJobs]);

  // Re-run match only when the track identity changes (not on position/state updates)
  useEffect(() => {
    if (!nowPlaying) {
      prevTrackKeyRef.current = null;
      setMatchData(null);
      return;
    }
    const key = `${nowPlaying.zone_id}||${nowPlaying.title}||${nowPlaying.artist}||${nowPlaying.album}`;
    if (key === prevTrackKeyRef.current) return;
    prevTrackKeyRef.current = key;
    fetchMatch();
  }, [nowPlaying, fetchMatch]);

  // ── After LRC generated: refresh everything ─────────────────────────────────

  function handleGenerated() {
    fetchJobs();
    fetchMatch();
    fetchTftAccount();
  }

  function handleJobRetried() {
    fetchJobs();
    fetchTftAccount();
  }

  // ── Playback control ─────────────────────────────────────────────────────────

  async function handleControl(action) {
    try {
      await fetch('/api/roon/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } catch { setBackendOnline(false); return; }
    // Short delay then refresh now-playing to reflect new state
    setTimeout(fetchNowPlaying, 300);
  }

  // ── Volume control ───────────────────────────────────────────────────────────

  async function handleVolumeChange(outputId, how, value) {
    try {
      await fetch('/api/roon/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: outputId, how, value }),
      });
    } catch { setBackendOnline(false); return; }
    setTimeout(fetchNowPlaying, 300);
  }

  async function handleMute(outputId, how) {
    try {
      await fetch('/api/roon/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_id: outputId, how }),
      });
    } catch { setBackendOnline(false); return; }
    setTimeout(fetchNowPlaying, 300);
  }

  async function handleSeek(how, seconds) {
    if (!nowPlaying?.zone_id) return;
    try {
      await fetch('/api/roon/seek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: nowPlaying.zone_id, how, seconds }),
      });
    } catch { setBackendOnline(false); }
  }

  async function handleSettings(settings) {
    if (!nowPlaying?.zone_id) return;
    try {
      await fetch('/api/roon/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: nowPlaying.zone_id, ...settings }),
      });
    } catch { setBackendOnline(false); return; }
    setTimeout(fetchNowPlaying, 400);
  }

  async function handleSelectZone(zoneId) {
    try {
      await fetch('/api/roon/active-zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: zoneId }),
      });
    } catch { setBackendOnline(false); return; }
    setTimeout(() => { fetchNowPlaying(); fetchZones(); }, 300);
  }

  async function handleTransfer(toZoneId) {
    try {
      await fetch('/api/roon/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_zone_id: toZoneId }),
      });
    } catch { setBackendOnline(false); return; }
    setTimeout(() => { fetchNowPlaying(); fetchZones(); }, 500);
  }

  async function handleGroup(outputIds) {
    try {
      await fetch('/api/roon/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_ids: outputIds }),
      });
    } catch { setBackendOnline(false); return; }
    setTimeout(() => { fetchNowPlaying(); fetchZones(); }, 500);
  }

  async function handleUngroup(outputIds) {
    try {
      await fetch('/api/roon/ungroup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_ids: outputIds }),
      });
    } catch { setBackendOnline(false); return; }
    setTimeout(() => { fetchNowPlaying(); fetchZones(); }, 500);
  }

  // ── Library rescan callback ──────────────────────────────────────────────────

  function handleRescanStarted() {
    setIndexStatus(s => s ? { ...s, scan_in_progress: true } : null);
    const interval = setInterval(async () => {
      const data = await apiFetch('/api/music/index/status');
      if (data) {
        setIndexStatus(data);
        if (!data.scan_in_progress) clearInterval(interval);
      }
    }, 2000);
  }

  // ── Language switcher ────────────────────────────────────────────────────────

  const currentLang = i18n.language?.slice(0, 2);

  return (
    <div className="app">
      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <header className="tft-topbar">
        <div className="tft-topbar-brand">
          <svg width="32" height="32" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="0" y="0" width="96" height="96" rx="22" fill="var(--tft-ink)"/>
            <path d="M22 26 L22 70 L30 70" stroke="var(--tft-paper)" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" fill="none"/>
            <path d="M74 26 L74 70 L66 70 M74 26 L66 26" stroke="var(--tft-paper)" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" fill="none"/>
            <rect x="36" y="34" width="24" height="6" fill="var(--tft-paper)"/>
            <rect x="45" y="34" width="6" height="20" fill="var(--tft-paper)"/>
            <g fill="var(--tft-signal)">
              <rect x="36" y="58" width="3" height="6"/>
              <rect x="42" y="54" width="3" height="14"/>
              <rect x="48" y="50" width="3" height="22"/>
              <rect x="54" y="56" width="3" height="10"/>
              <rect x="60" y="60" width="3" height="3"/>
            </g>
          </svg>
          <div className="tft-topbar-wordmark">
            <span className="tft-topbar-name">TextFromTrack</span>
            <span className="tft-topbar-sub">roon companion</span>
          </div>
        </div>

        <div className="tft-topbar-right">
          {!backendOnline && (
            <div className="tft-backend-offline-pill" title={t('status.backend_offline_hint')}>
              <span className="backend-offline-dot" />
              <span>{t('status.backend_offline')}</span>
            </div>
          )}
          {roonStatus && (
            <button className="tft-roon-strip tft-roon-strip-btn" onClick={() => setRoonModalOpen(true)} title={t('section.roon_connection')}>
              <span className={`roon-dot${roonStatus.connected ? '' : ' offline'}`} />
              <span className="tft-mono" style={{ fontSize: 12, color: 'var(--tft-ink-3)' }}>
                {roonStatus.core_name || 'Roon'}
                {zones.length > 0 ? ` · ${zones.length} zone${zones.length !== 1 ? 's' : ''}` : ''}
              </span>
            </button>
          )}

          {tftAccount?.credit_balance != null && (
            <button
              className={`tft-credit-pill tft-credit-pill-btn${(tftAccount.credit_available ?? tftAccount.credit_balance) === 0 ? ' tft-credit-pill--zero' : ''}`}
              onClick={refreshTftCredits}
              title="Click to refresh credit balance"
              disabled={refreshingCredits}
            >
              <span className="credit-dot" />
              <span className="tft-mono" style={{ fontSize: 12 }}>
                {refreshingCredits ? '…' : `${tftAccount.credit_available ?? tftAccount.credit_balance} credits`}
              </span>
            </button>
          )}

          <div className="lang-switcher">
            {['en', 'fr'].map(lang => (
              <button
                key={lang}
                className={`lang-btn${currentLang === lang ? ' lang-btn-active' : ''}`}
                onClick={() => i18n.changeLanguage(lang)}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            className="tft-settings-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('settings.title', 'Configuration')}
            aria-label={t('settings.title', 'Configuration')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          {tftAccount?.email && (
            <div className="tft-avatar">{tftAccount.email[0].toUpperCase()}</div>
          )}
        </div>
      </header>

      {/* ── Roon status modal ────────────────────────────────────────────────── */}
      {roonModalOpen && (
        <div className="modal-backdrop" onClick={() => setRoonModalOpen(false)}>
          <div className="tft-roon-modal" onClick={e => e.stopPropagation()}>
            <div className="tft-roon-modal-head">
              <span className="tft-eyebrow">{t('section.roon_connection')}</span>
              <button className="tft-settings-close" onClick={() => setRoonModalOpen(false)} aria-label="Fermer">✕</button>
            </div>
            <RoonStatus data={roonStatus} />
          </div>
        </div>
      )}

      {/* ── Settings drawer ─────────────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="tft-settings-backdrop" onClick={() => setSettingsOpen(false)}>
          <aside className="tft-settings-drawer" onClick={e => e.stopPropagation()}>
            <div className="tft-settings-drawer-head">
              <span className="tft-eyebrow">{t('settings.title', 'Configuration')}</span>
              <button className="tft-settings-close" onClick={() => setSettingsOpen(false)} aria-label="Fermer">✕</button>
            </div>
            <div className="tft-settings-drawer-body">
              <TftApiKey onTokenSaved={fetchTftAccount} />
              <AppPrefs prefs={prefs} setPref={setPref} />
              <FilesManagement />
              <LibrarySettings onRescanStarted={handleRescanStarted} />
            </div>
          </aside>
        </div>
      )}

      {/* ── 2-column main ───────────────────────────────────────────────────── */}
      <main className="tft-main">

        {/* Hero column: Zone bar + HeroCard + JobHistory */}
        <div className="tft-hero-col">
          {/* Zone bar */}
          <div className="tft-zone-bar">
            <span className="tft-eyebrow" style={{ whiteSpace: 'nowrap' }}>{t('section.zones', 'Zones')}</span>
            <ZoneSelector
              zones={zones}
              activeZoneId={nowPlaying?.zone_id}
              onSelect={handleSelectZone}
              onTransfer={handleTransfer}
              onGroup={handleGroup}
              onUngroup={handleUngroup}
            />
          </div>

          <HeroCard
            nowPlaying={nowPlaying}
            matchData={matchData}
            tftAccount={tftAccount}
            onControl={handleControl}
            onVolume={handleVolumeChange}
            onMute={handleMute}
            onSeek={handleSeek}
            onSettings={handleSettings}
            onGenerated={handleGenerated}
            onSearch={(q) => setSearchTrigger({ q, ts: Date.now() })}
            volumeStep={prefs.volumeStep}
          />
          <SearchPanel zones={zones} activeZoneId={nowPlaying?.zone_id} externalQuery={searchTrigger} />
          <JobHistory jobs={jobs} onJobRetried={handleJobRetried} />
        </div>
      </main>
    </div>
  );
}
