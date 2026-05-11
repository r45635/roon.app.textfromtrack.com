import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import HeroCard from './components/HeroCard.jsx';
import RoonStatus from './components/RoonStatus.jsx';
import ZoneSelector from './components/ZoneSelector.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import JobHistory from './components/JobHistory.jsx';
import LibrarySettings from './components/LibrarySettings.jsx';
import AppPrefs from './components/AppPrefs.jsx';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roonModalOpen, setRoonModalOpen] = useState(false);
  const [searchTrigger, setSearchTrigger] = useState(null);

  // ── API helpers ──────────────────────────────────────────────────────────────

  async function apiFetch(endpoint) {
    const res = await fetch(endpoint);
    if (!res.ok) return null;
    return res.json().catch(() => null);
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
    if (data) setTftAccount(data);
  }, []);

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

    // Continuous polling — tick every 500 ms, actual fetch rate governed by roonPollMsRef
    let lastRoonFetch = Date.now();
    const roonInterval = setInterval(async () => {
      if (Date.now() - lastRoonFetch < roonPollMsRef.current) return;
      lastRoonFetch = Date.now();
      await fetchRoonStatus();
      await fetchNowPlaying();
      await fetchZones();
    }, 500);

    const jobsInterval = setInterval(fetchJobs, JOBS_POLL_MS);

    return () => {
      clearInterval(roonInterval);
      clearInterval(jobsInterval);
    };
  }, [fetchRoonStatus, fetchNowPlaying, fetchZones, fetchJobs]);

  // Re-run match whenever now-playing changes
  useEffect(() => {
    if (nowPlaying) {
      fetchMatch();
    } else {
      setMatchData(null);
    }
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
    await fetch('/api/roon/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    // Short delay then refresh now-playing to reflect new state
    setTimeout(fetchNowPlaying, 300);
  }

  // ── Volume control ───────────────────────────────────────────────────────────

  async function handleVolumeChange(outputId, how, value) {
    await fetch('/api/roon/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_id: outputId, how, value }),
    });
    setTimeout(fetchNowPlaying, 300);
  }

  async function handleMute(outputId, how) {
    await fetch('/api/roon/mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_id: outputId, how }),
    });
    setTimeout(fetchNowPlaying, 300);
  }

  async function handleSeek(how, seconds) {
    if (!nowPlaying?.zone_id) return;
    await fetch('/api/roon/seek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone_id: nowPlaying.zone_id, how, seconds }),
    });
  }

  async function handleSettings(settings) {
    if (!nowPlaying?.zone_id) return;
    await fetch('/api/roon/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone_id: nowPlaying.zone_id, ...settings }),
    });
    setTimeout(fetchNowPlaying, 400);
  }

  async function handleSelectZone(zoneId) {
    await fetch('/api/roon/active-zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone_id: zoneId }),
    });
    setTimeout(() => { fetchNowPlaying(); fetchZones(); }, 300);
  }

  async function handleTransfer(toZoneId) {
    await fetch('/api/roon/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_zone_id: toZoneId }),
    });
    setTimeout(() => { fetchNowPlaying(); fetchZones(); }, 500);
  }

  async function handleGroup(outputIds) {
    await fetch('/api/roon/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_ids: outputIds }),
    });
    setTimeout(() => { fetchNowPlaying(); fetchZones(); }, 500);
  }

  async function handleUngroup(outputIds) {
    await fetch('/api/roon/ungroup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_ids: outputIds }),
    });
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
          <span className="tft-mark">
            <span className="b">[</span><span className="t">T</span><span className="b">]</span>
          </span>
          <div className="tft-topbar-wordmark">
            <span className="tft-topbar-name">extFromTrack</span>
            <span className="tft-topbar-sub">roon companion</span>
          </div>
        </div>

        <div className="tft-topbar-right">
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
            <div className="tft-credit-pill">
              <span className="credit-dot" />
              <span className="tft-mono" style={{ fontSize: 12 }}>
                {tftAccount.credit_available ?? tftAccount.credit_balance} credits
              </span>
            </div>
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
              <AppPrefs prefs={prefs} setPref={setPref} />
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
