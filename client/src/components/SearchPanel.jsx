import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';
import { useRoonBrowser } from '../hooks/useRoonBrowser.js';
import RoonBrowserList from './RoonBrowserList.jsx';

const TAB_KEY = 'tft:libraryTab';

function readTab() {
  try { return localStorage.getItem(TAB_KEY) === 'browse' ? 'browse' : 'search'; } catch { return 'search'; }
}

/**
 * The Roon library card: search, or browse Roon's own menus (Library, Playlists, My Live Radio,
 * Internet Radio, Genres…), and play what you find on a zone.
 */
export default function SearchPanel({ zones = [], activeZoneId = null, externalQuery = null }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('search');
  const [tab, setTabState] = useState(readTab);
  const [query, setQuery] = useState('');
  const [playZoneId, setPlayZoneId] = useState(activeZoneId || '');
  // hideEmpty: filter out results whose subtitle starts with "0 " (no albums/tracks)
  const [hideEmpty, setHideEmpty] = useState(true);
  const inputRef = useRef(null);

  const search = useRoonBrowser('search', { zoneId: playZoneId });
  const browse = useRoonBrowser('browse', { zoneId: playZoneId });

  useEffect(() => {
    if (activeZoneId && !playZoneId) setPlayZoneId(activeZoneId);
  }, [activeZoneId, playZoneId]);

  function setTab(next) {
    setTabState(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* blocked */ }
  }

  // Browse opens at Roon's root the first time the tab is shown.
  useEffect(() => {
    if (tab === 'browse' && !collapsed && browse.navStack.length === 0 && !browse.loading && !browse.error) {
      browse.open(t('browse.root'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, collapsed]);

  const zoneOptions = useMemo(() =>
    (zones || []).map(z => ({ id: z.zone_id || z.id, name: z.display_name || z.name })).filter(z => z.id),
    [zones]
  );

  function runSearch(q) {
    search.open(q, { input: q });
  }

  function handleSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (q) runSearch(q);
  }

  // External search trigger (artist/album link in the player)
  useEffect(() => {
    if (!externalQuery) return;
    const q = (externalQuery.q || '').trim();
    if (!q) return;
    if (collapsed) toggleCollapsed();
    setTab('search');
    setQuery(q);
    runSearch(q);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalQuery]);

  function handleClear() {
    setQuery('');
    search.clear();
    inputRef.current?.focus();
  }

  const active = tab === 'browse' ? browse : search;

  return (
    <section className={`card search-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('browse.card_title')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed}
          title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      <div className="card-body">
        <div className="search-tabs" role="tablist">
          {['search', 'browse'].map(name => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={`search-tab${tab === name ? ' active' : ''}`}
              onClick={() => setTab(name)}
            >
              {t(`browse.tab_${name}`)}
            </button>
          ))}
          {tab === 'browse' && browse.navStack.length > 1 && (
            <button type="button" className="btn btn-ghost btn-sm search-tab-home" onClick={() => browse.open(t('browse.root'))} disabled={browse.loading}>
              {t('browse.home')}
            </button>
          )}
        </div>

        {tab === 'search' && (
          <form className="search-form" onSubmit={handleSearch}>
            <div className="search-input-row">
              <input
                ref={inputRef}
                type="text"
                className="search-input"
                placeholder={t('search.placeholder')}
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={search.loading}
              />
              {(query || search.navStack.length > 0) && (
                <button type="button" className="btn btn-ghost search-clear" onClick={handleClear}>✕</button>
              )}
              <button type="submit" className="btn btn-primary" disabled={search.loading || !query.trim()}>
                {search.loading ? '…' : t('search.search_btn')}
              </button>
            </div>
          </form>
        )}

        {active.error && <p className="search-error">{active.error}</p>}
        {tab === 'browse' && browse.loading && browse.navStack.length === 0 && <p className="muted small">{t('common.loading')}</p>}

        <RoonBrowserList
          browser={active}
          zoneOptions={zoneOptions}
          playZoneId={playZoneId}
          onPlayZoneChange={setPlayZoneId}
          filter={tab === 'search' && hideEmpty ? items => items.filter(item => !item.subtitle?.match(/^0\s/)) : null}
          headerExtra={tab === 'search' && (
            <label className="search-hide-empty-toggle">
              <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} />
              <span>{t('search.hide_empty')}</span>
            </label>
          )}
        />
      </div>
    </section>
  );
}
