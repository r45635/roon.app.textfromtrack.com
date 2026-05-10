import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import RoonStatus from './components/RoonStatus.jsx';
import NowPlaying from './components/NowPlaying.jsx';
import ZoneSelector from './components/ZoneSelector.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import LocalMatch from './components/LocalMatch.jsx';
import TftPanel from './components/TftPanel.jsx';
import JobHistory from './components/JobHistory.jsx';
import LibrarySettings from './components/LibrarySettings.jsx';

const ROON_POLL_MS = 3000;
const JOBS_POLL_MS = 5000;

export default function App() {
  const { i18n, t } = useTranslation();

  const [roonStatus, setRoonStatus] = useState(null);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [zones, setZones] = useState([]);
  const [matchData, setMatchData] = useState(null);
  const [indexStatus, setIndexStatus] = useState(null);
  const [tftAccount, setTftAccount] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [confirmedPath, setConfirmedPath] = useState(null);

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

    // Continuous polling
    const roonInterval = setInterval(async () => {
      await fetchRoonStatus();
      await fetchNowPlaying();
      await fetchZones();
    }, ROON_POLL_MS);

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
      <header className="app-header">
        <div className="app-header-inner">
          <div className="header-brand">
            <span className="header-icon">🎵</span>
            <div>
              <h1>{t('app.title')}</h1>
              <p className="header-subtitle">{t('app.subtitle')}</p>
            </div>
          </div>
          <div className="lang-switcher">
            <button
              className={`lang-btn ${currentLang === 'en' ? 'lang-btn-active' : ''}`}
              onClick={() => i18n.changeLanguage('en')}
            >
              {t('nav.lang_en')}
            </button>
            <button
              className={`lang-btn ${currentLang === 'fr' ? 'lang-btn-active' : ''}`}
              onClick={() => i18n.changeLanguage('fr')}
            >
              {t('nav.lang_fr')}
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="col-left">
          <RoonStatus data={roonStatus} />
          <ZoneSelector
            zones={zones}
            activeZoneId={nowPlaying?.zone_id}
            onSelect={handleSelectZone}
            onTransfer={handleTransfer}
            onGroup={handleGroup}
            onUngroup={handleUngroup}
          />
          <NowPlaying
            data={nowPlaying}
            onRefresh={fetchNowPlaying}
            onControl={handleControl}
            onVolume={handleVolumeChange}
            onMute={handleMute}
            onSeek={handleSeek}
            onSettings={handleSettings}
          />
          <LocalMatch
            data={matchData}
            indexStatus={indexStatus}
            onScan={handleScan}
            onConfirm={setConfirmedPath}
            confirmedPath={confirmedPath}
          />
          <LibrarySettings onRescanStarted={handleRescanStarted} />
        </div>

        <div className="col-right">
          <SearchPanel zones={zones} activeZoneId={nowPlaying?.zone_id} />
          <TftPanel
            tftAccount={tftAccount}
            matchData={matchData}
            nowPlaying={nowPlaying}
            onGenerated={handleGenerated}
          />
          <JobHistory jobs={jobs} onJobRetried={handleJobRetried} />
        </div>
      </main>
    </div>
  );
}
