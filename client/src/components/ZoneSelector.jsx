import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

/** Roon sends no device icon: show what is playing (cover), else a neutral speaker. */
function ZoneArt({ zone, size = 36 }) {
  if (zone?.image_key) {
    return <img className="zone-art" src={`/api/roon/image/${zone.image_key}?w=${size * 2}&h=${size * 2}`} alt="" width={size} height={size} loading="lazy" />;
  }
  return (
    <span className="zone-art zone-art--empty" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="14" r="4" /><line x1="12" y1="6" x2="12.01" y2="6" />
      </svg>
    </span>
  );
}

/** "42", "−30 dB", "muted" — Roon volumes are numbers, dB, or +/- only (incremental). */
function volumeText(v, t) {
  if (!v) return null;
  if (v.is_muted) return t('zones.muted');
  if (v.type === 'incremental' || v.value == null) return null;
  return v.type === 'db' ? `${v.value} dB` : String(v.value);
}

const ZoneSelector = forwardRef(function ZoneSelector({ zones, activeZoneId, onSelect, onTransfer, onGroup, onUngroup }, ref) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [groupMode, setGroupMode] = useState(false);
  const [groupSelected, setGroupSelected] = useState([]);
  const rootRef = useRef(null);

  useImperativeHandle(ref, () => ({ open: () => setExpanded(true) }));

  // Close on a click or tap outside, and on Escape.
  useEffect(() => {
    if (!expanded) return undefined;
    const close = () => { setExpanded(false); setGroupMode(false); setGroupSelected([]); };
    const onPointerDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

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
    <div className="zone-selector" ref={rootRef}>
      <button
        className="btn btn-ghost zone-selector-trigger"
        onClick={() => setExpanded(e => !e)}
        title={t('zones.change_zone')}
        aria-expanded={expanded}
        aria-haspopup="listbox"
      >
        <ZoneArt zone={activeZone} size={22} />
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
                const outputs = zone.outputs || [];
                const grouped = outputs.length > 1;
                const standby = outputs.length > 0 && outputs.every(o => o.standby);
                const vol = outputs.length === 1 ? volumeText(outputs[0].volume, t) : null;
                const meta = [
                  standby ? t('zones.standby') : t(`now_playing.state_${zone.state || 'stopped'}`, zone.state),
                  grouped ? t('zones.grouped', { count: outputs.length - 1 }) : null,
                  vol ? `${t('zones.volume')} ${vol}` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <li key={zone.zone_id} className={`zone-item${isActive ? ' zone-item-active' : ''}`}>
                    <ZoneArt zone={zone} />
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
                      <div className="zone-item-meta" title={grouped ? outputs.map(o => o.display_name).join(', ') : undefined}>
                        {meta}
                      </div>
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
});

export default ZoneSelector;
