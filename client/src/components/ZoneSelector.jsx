import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function ZoneSelector({ zones, activeZoneId, onSelect, onTransfer, onGroup, onUngroup }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [groupSelected, setGroupSelected] = useState([]);

  if (!zones || zones.length === 0) return null;

  const activeZone = zones.find(z => z.zone_id === activeZoneId) || zones[0];

  function handleSelect(zone_id) {
    onSelect(zone_id);
    setExpanded(false);
    setGroupMode(false);
    setGroupSelected([]);
  }

  function handleTransfer(zone_id) {
    onTransfer(zone_id);
    setExpanded(false);
  }

  function toggleGroupSelect(output_id) {
    setGroupSelected(prev =>
      prev.includes(output_id) ? prev.filter(id => id !== output_id) : [...prev, output_id]
    );
  }

  function handleGroup() {
    if (groupSelected.length >= 2) {
      onGroup(groupSelected);
      setGroupMode(false);
      setGroupSelected([]);
      setExpanded(false);
    }
  }

  // All outputs across all zones (for grouping)
  const allOutputs = zones.flatMap(z =>
    (z.outputs || []).map(o => ({ ...o, zone_id: z.zone_id, zone_name: z.display_name }))
  );

  return (
    <div className="zone-selector">
      <button
        className="btn btn-ghost zone-selector-trigger"
        onClick={() => setExpanded(e => !e)}
        title={t('zones.change_zone')}
      >
        <span className="zone-icon">📻</span>
        <span className="zone-active-name">{activeZone.display_name}</span>
        <span className="zone-caret">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="zone-dropdown">
          <div className="zone-dropdown-header">
            <span>{t('zones.all_zones')}</span>
            <div className="zone-header-actions">
              {onGroup && allOutputs.length > 1 && (
                <button
                  className={`btn btn-xs${groupMode ? ' btn-primary' : ''}`}
                  onClick={() => { setGroupMode(g => !g); setGroupSelected([]); }}
                  title={t('zones.group_outputs')}
                >⊕ {t('zones.group')}</button>
              )}
              <button className="btn btn-xs btn-ghost" onClick={() => setExpanded(false)}>✕</button>
            </div>
          </div>

          {groupMode ? (
            <div className="zone-group-picker">
              <p className="zone-group-hint">{t('zones.group_hint')}</p>
              {allOutputs.map(o => (
                <label key={o.output_id} className="zone-group-row">
                  <input
                    type="checkbox"
                    checked={groupSelected.includes(o.output_id)}
                    onChange={() => toggleGroupSelect(o.output_id)}
                  />
                  <span>{o.zone_name} — {o.display_name}</span>
                </label>
              ))}
              <div className="zone-group-footer">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={groupSelected.length < 2}
                  onClick={handleGroup}
                >{t('zones.group_confirm')}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setGroupMode(false); setGroupSelected([]); }}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <ul className="zone-list">
              {zones.map(zone => {
                const isActive = zone.zone_id === activeZoneId;
                const isPlaying = zone.state === 'playing';
                return (
                  <li key={zone.zone_id} className={`zone-item${isActive ? ' zone-item-active' : ''}`}>
                    <div className="zone-item-main">
                      <button
                        className="zone-item-name"
                        onClick={() => handleSelect(zone.zone_id)}
                        title={t('zones.switch_to')}
                      >
                        <span className={`zone-state-dot${isPlaying ? ' dot-playing' : ''}`} />
                        <span>{zone.display_name}</span>
                        {isActive && <span className="zone-active-badge">✓</span>}
                      </button>
                      {zone.now_playing_title && (
                        <div className="zone-item-track">
                          {zone.now_playing_title}
                          {zone.now_playing_artist && ` — ${zone.now_playing_artist}`}
                        </div>
                      )}
                    </div>
                    {onTransfer && !isActive && (
                      <button
                        className="btn btn-xs btn-ghost zone-transfer-btn"
                        onClick={() => handleTransfer(zone.zone_id)}
                        title={t('zones.transfer_here')}
                      >⇄ {t('zones.transfer')}</button>
                    )}
                    {onUngroup && zone.outputs?.length > 1 && (
                      <button
                        className="btn btn-xs btn-ghost zone-ungroup-btn"
                        onClick={() => { onUngroup(zone.outputs.map(o => o.output_id)); setExpanded(false); }}
                        title={t('zones.ungroup')}
                      >⊖</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
