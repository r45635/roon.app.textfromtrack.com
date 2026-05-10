import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

export default function SearchPanel({ zones = [], activeZoneId = null }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('search');
  const [query, setQuery] = useState('');
  // navStack: [{ title, itemKey, items, listMeta }]
  // each entry is a snapshot — breadcrumb back navigation is instant (no API)
  const [navStack, setNavStack] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playZoneId, setPlayZoneId] = useState(activeZoneId || '');
  const [playing, setPlaying] = useState(null);
  const [playFeedback, setPlayFeedback] = useState({});
  // actionMenu: { itemKey, actions: [{title, item_key}] } | null
  const [actionMenu, setActionMenu] = useState(null);
  // hideEmpty: filter out items with subtitle starting with "0 " (no albums/tracks)
  const [hideEmpty, setHideEmpty] = useState(true);
  const inputRef = useRef(null);

  useEffect(() => {
    if (activeZoneId && !playZoneId) setPlayZoneId(activeZoneId);
  }, [activeZoneId, playZoneId]);

  const zoneOptions = useMemo(() =>
    (zones || []).map(z => ({ id: z.zone_id || z.id, name: z.display_name || z.name })).filter(z => z.id),
    [zones]
  );

  const currentLevel = navStack.length > 0 ? navStack[navStack.length - 1] : null;
  const items = currentLevel?.items || [];
  const listMeta = currentLevel?.listMeta || null;

  // ── browse + load helper ──────────────────────────────────────────────────
  async function browseLoad(browseOpts) {
    const brRes = await fetch('/api/roon/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(browseOpts),
    });
    const brData = await brRes.json();
    if (!brRes.ok || !brData.success) throw new Error(brData?.error?.message || `HTTP ${brRes.status}`);
    if (brData.action === 'message') {
      if (brData.is_error) throw new Error(brData.message || 'Roon error');
      return null;
    }
    if (brData.action !== 'list') return null;

    const ldRes = await fetch('/api/roon/browse/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hierarchy: browseOpts.hierarchy || 'search', count: 100 }),
    });
    const ldData = await ldRes.json();
    if (!ldRes.ok || !ldData.success) throw new Error(ldData?.error?.message || `HTTP ${ldRes.status}`);
    return { items: ldData.items || [], listMeta: ldData.list || null };
  }

  // ── initial search ────────────────────────────────────────────────────────
  async function handleSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true); setError(null); setPlayFeedback({}); setActionMenu(null);
    try {
      const result = await browseLoad({ hierarchy: 'search', pop_all: true, input: q });
      if (!result) { setNavStack([]); return; }
      setNavStack([{ title: q, itemKey: null, items: result.items, listMeta: result.listMeta }]);
    } catch (err) {
      setError(err.message); setNavStack([]);
    } finally {
      setLoading(false);
    }
  }

  // ── drill into a list item ────────────────────────────────────────────────
  async function handleDrillIn(item) {
    setLoading(true); setError(null); setPlayFeedback({}); setActionMenu(null);
    try {
      const result = await browseLoad({
        hierarchy: 'search',
        item_key: item.item_key,
        zone_or_output_id: playZoneId || undefined,
      });
      if (!result) return;
      setNavStack(prev => [
        ...prev,
        { title: item.title, itemKey: item.item_key, items: result.items, listMeta: result.listMeta },
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── breadcrumb click — uses snapshot, no API call ─────────────────────────
  function handleBreadcrumb(idx) {
    setNavStack(prev => prev.slice(0, idx + 1));
    setError(null); setPlayFeedback({}); setActionMenu(null);
  }

  function handleClear() {
    setQuery(''); setNavStack([]); setError(null); setPlayFeedback({}); setActionMenu(null);
    inputRef.current?.focus();
  }

  // ── load Roon actions for an action_list item and show menu ──────────────
  async function handleActionsLoad(item) {
    // Toggle off if already open for this item
    if (actionMenu?.itemKey === item.item_key) { setActionMenu(null); return; }
    if (!playZoneId) {
      setPlayFeedback(prev => ({ ...prev, [item.item_key]: { ok: false, message: t('search.play_pick_zone') } }));
      return;
    }
    setPlaying(item.item_key);
    setPlayFeedback(prev => ({ ...prev, [item.item_key]: null }));
    setActionMenu(null);
    try {
      // First drill: into the action_list item
      const result = await browseLoad({
        hierarchy: 'search',
        item_key: item.item_key,
        zone_or_output_id: playZoneId,
      });
      if (!result) { setPlaying(null); return; }

      let actions = result.items.filter(a => a.hint === 'action' && a.item_key);

      // Second drill: some items (e.g. tracks from a flat search) wrap actions
      // in a nested action_list — drill one more level to reach the real actions.
      if (actions.length === 0) {
        const nested = result.items.find(a => a.hint === 'action_list' && a.item_key);
        if (nested) {
          const r2 = await browseLoad({
            hierarchy: 'search',
            item_key: nested.item_key,
            zone_or_output_id: playZoneId,
          });
          if (r2) actions = r2.items.filter(a => a.hint === 'action' && a.item_key);
        }
      }

      if (actions.length === 0) {
        setPlayFeedback(prev => ({ ...prev, [item.item_key]: { ok: false, message: t('search.no_actions', 'Aucune action disponible') } }));
      } else {
        setActionMenu({ itemKey: item.item_key, actions });
      }
    } catch (err) {
      setPlayFeedback(prev => ({ ...prev, [item.item_key]: { ok: false, message: err.message } }));
    } finally {
      setPlaying(null);
    }
  }

  // ── execute a specific Roon action ────────────────────────────────────────
  async function executeAction(parentKey, actionItem) {
    setActionMenu(null);
    setPlaying(parentKey);
    try {
      const res = await fetch('/api/roon/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hierarchy: 'search',
          item_key: actionItem.item_key,
          zone_or_output_id: playZoneId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setPlayFeedback(prev => ({ ...prev, [parentKey]: { ok: true, message: actionItem.title } }));
    } catch (err) {
      setPlayFeedback(prev => ({ ...prev, [parentKey]: { ok: false, message: err.message } }));
    } finally {
      setPlaying(null);
    }
  }

  return (
    <section className={`card search-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('search.title')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed}
          title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      <div className="card-body">
        <form className="search-form" onSubmit={handleSearch}>
          <div className="search-input-row">
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder={t('search.placeholder')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              disabled={loading}
            />
            {(query || navStack.length > 0) && (
              <button type="button" className="btn btn-ghost search-clear" onClick={handleClear}>✕</button>
            )}
            <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
              {loading ? '…' : t('search.search_btn')}
            </button>
          </div>
        </form>

        {error && <p className="search-error">{error}</p>}

        {navStack.length > 0 && (
          <div className="search-results">

            {/* Breadcrumb navigation */}
            {navStack.length > 1 && (
              <div className="search-breadcrumb">
                {navStack.map((level, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <span className="search-breadcrumb-sep">›</span>}
                    <button
                      className={`search-breadcrumb-item${idx === navStack.length - 1 ? ' active' : ''}`}
                      onClick={() => handleBreadcrumb(idx)}
                      disabled={idx === navStack.length - 1}
                    >
                      {level.title}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Zone picker + count + hide-empty toggle */}
            <div className="search-results-header">
              {listMeta?.count != null && (
                <p className="search-count">{t('search.result_count', { count: listMeta.count })}</p>
              )}
              <label className="search-hide-empty-toggle">
                <input
                  type="checkbox"
                  checked={hideEmpty}
                  onChange={e => setHideEmpty(e.target.checked)}
                />
                <span>{t('search.hide_empty')}</span>
              </label>
              <label className="search-zone-picker">
                <span className="muted small">{t('search.play_on_zone')}</span>
                <select value={playZoneId || ''} onChange={e => setPlayZoneId(e.target.value)}>
                  <option value="">{t('search.select_zone')}</option>
                  {zoneOptions.map(z => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {items.length === 0 && !loading && (
              <p className="muted">{t('search.no_results')}</p>
            )}

            {/* Item list */}
            <div className="search-results-scroll">
              <ul className="search-list">
                {(hideEmpty ? items.filter(item => !item.subtitle?.match(/^0\s/)) : items).map((item, idx) => {
                  const key = item.item_key || `item-${idx}`;
                  const fb = playFeedback[item.item_key];
                  const isHeader = item.hint === 'header';
                  const isDrillable = item.hint === 'list' && item.item_key;
                  const isPlayable = (item.hint === 'action_list' || item.hint === 'action') && item.item_key;

                  return (
                    <li
                      key={key}
                      className={[
                        'search-item',
                        isHeader ? 'search-item-header' : '',
                        isDrillable ? 'search-item-drillable' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={isDrillable ? () => handleDrillIn(item) : undefined}
                    >
                      {(item.image_key || listMeta?.image_key) && !isHeader && (
                        <img
                          className="search-item-thumb"
                          src={`/api/roon/image/${item.image_key || listMeta.image_key}?w=40&h=40`}
                          alt=""
                          loading="lazy"
                        />
                      )}
                      <div className="search-item-info">
                        <span className="search-item-title">{item.title}</span>
                        {item.subtitle && (
                          <span className="search-item-sub">{item.subtitle}</span>
                        )}
                        {fb && (
                          <span className={`small search-play-feedback ${fb.ok ? 'text-success' : 'text-error'}`}>
                            {fb.ok ? '✓' : '⚠'} {fb.message}
                          </span>
                        )}
                      </div>

                      {/* Drill-in arrow for list items */}
                      {isDrillable && (
                        <button
                          type="button"
                          className="btn btn-ghost search-drill-btn"
                          onClick={e => { e.stopPropagation(); handleDrillIn(item); }}
                          disabled={loading}
                          title={t('search.drill_in', 'Ouvrir')}
                        >›</button>
                      )}

                      {/* Action menu button for action_list / action items */}
                      {isPlayable && (
                        <div className="search-play-wrap">
                          <button
                            type="button"
                            className={`btn btn-xs search-play-btn${actionMenu?.itemKey === item.item_key ? ' btn-ghost' : ' btn-primary'}`}
                            onClick={() => handleActionsLoad(item)}
                            disabled={playing === item.item_key || !playZoneId}
                            title={!playZoneId ? t('search.play_pick_zone') : t('search.play_now_tip')}
                          >
                            {playing === item.item_key ? '…' : '▶'}
                          </button>
                          {actionMenu?.itemKey === item.item_key && (
                            <div className="search-action-menu">
                              {actionMenu.actions.map(action => (
                                <button
                                  key={action.item_key}
                                  type="button"
                                  className="search-action-item"
                                  onClick={() => executeAction(item.item_key, action)}
                                >
                                  {action.title}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
