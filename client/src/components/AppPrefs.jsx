import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

const POLL_PRESETS = [500, 1000, 2000, 3000, 5000];

export default function AppPrefs({ prefs, setPref }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('app-prefs', false);

  function handleVolumeStep(e) {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v >= 1 && v <= 20) setPref('volumeStep', v);
  }

  function handlePollMs(e) {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v >= 500 && v <= 30000) setPref('roonPollMs', v);
  }

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('settings.app_prefs_title', 'App Preferences')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      {!collapsed && (
        <div className="card-body">
          <div className="settings-body">

            {/* Volume step */}
            <div className="app-pref-row">
              <label className="settings-label" title={t('settings.volume_step_hint')}>
                {t('settings.volume_step', 'Volume step (± per click)')}
              </label>
              <div className="app-pref-control">
                <button
                  className="tft-round-btn"
                  style={{ width: 24, height: 24, fontSize: 13 }}
                  onClick={() => setPref('volumeStep', Math.max(1, prefs.volumeStep - 1))}
                >−</button>
                <input
                  className="app-pref-num"
                  type="number"
                  min={1}
                  max={20}
                  value={prefs.volumeStep}
                  onChange={handleVolumeStep}
                />
                <button
                  className="tft-round-btn"
                  style={{ width: 24, height: 24, fontSize: 13 }}
                  onClick={() => setPref('volumeStep', Math.min(20, prefs.volumeStep + 1))}
                >+</button>
              </div>
            </div>

            {/* Poll interval */}
            <div className="app-pref-row">
              <label className="settings-label" title={t('settings.roon_poll_ms_hint')}>
                {t('settings.roon_poll_ms', 'Player refresh interval (ms)')}
              </label>
              <div className="app-pref-control" style={{ flexWrap: 'wrap' }}>
                {POLL_PRESETS.map(ms => (
                  <button
                    key={ms}
                    className={`tft-round-btn${prefs.roonPollMs === ms ? ' active' : ''}`}
                    style={{ height: 24, padding: '0 8px', fontSize: 11, borderRadius: 12 }}
                    onClick={() => setPref('roonPollMs', ms)}
                  >
                    {ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                  </button>
                ))}
                <input
                  className="app-pref-num"
                  type="number"
                  min={500}
                  max={30000}
                  step={500}
                  value={prefs.roonPollMs}
                  onChange={handlePollMs}
                  title="Custom (ms)"
                />
              </div>
            </div>

          </div>
        </div>
      )}
    </section>
  );
}

