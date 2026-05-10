import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

const CATEGORIES = ['tracks', 'albums', 'artists'];

// Items whose `hint` is one of these can be triggered as a play-action by
// drilling and picking the "Play Now" sub-item. `list` items (artists, etc.)
// are NOT directly playable from a top-level search hit — the user has to
// drill in first.
const PLAYABLE_HINTS = new Set(['action_list', 'action']);

export default function SearchPanel({ zones = [], activeZoneId = null }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('search');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playZoneId, setPlayZoneId] = useState(activeZoneId || '');
  const [playing, setPlaying] = useState(null);            // item_key being launched
  const [playFeedback, setPlayFeedback] = useState({});    // { [item_key]: { ok: bool, message: string } }
  const inputRef = useRef(null);

  // When the active zone changes upstream, follow it (unless the user picked
  // something else manually for this session).
  useEffect(() => {
    if (activeZoneId && !playZoneId) setPlayZoneId(activeZoneId);
  }, [activeZoneId, playZoneId]);

  const zoneOptions = useMemo(() => {
    return (zones || []).map(z => ({
      id: z.zone_id || z.id,
      name: z.display_name || z.name,
    })).filter(z => z.id);
  }, [zones]);

  async function handleSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const params = new URLSearchParams({ q });
      if (category) params.set('category', category);
      const res = await fetch(`/api/roon/search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || res.statusText);
      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setQuery('');
    setResults(null);
    setError(null);
    setPlayFeedback({});
    inputRef.current?.focus();
  }

  async function handlePlay(itemKey) {
    if (!playZoneId) {
      setPlayFeedback(prev => ({
        ...prev,
        [itemKey]: { ok: false, message: t('search.play_pick_zone') },
      }));
      return;
    }
    setPlaying(itemKey);
    setPlayFeedback(prev => ({ ...prev, [itemKey]: null }));
    try {
      const res = await fetch('/api/roon/play-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_key: itemKey,
          hierarchy: 'search',
          zone_or_output_id: playZoneId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      setPlayFeedback(prev => ({
        ...prev,
        [itemKey]: { ok: true, message: data.action_used || t('search.play_started') },
      }));
    } catch (err) {
      setPlayFeedback(prev => ({
        ...prev,
        [itemKey]: { ok: false, message: err.message },
      }));
    } finally {
      setPlaying(null);
    }
  }

  const items = results?.items || [];

  return (
    <section className={`card search-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('search.title')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
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
          {query && (
            <button type="button" className="btn btn-ghost search-clear" onClick={handleClear}>✕</button>
          )}
          <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
            {loading ? '…' : t('search.search_btn')}
          </button>
        </div>

        <div className="search-cat-row">
          <span className="search-cat-label">{t('search.filter')}</span>
          <button
            type="button"
            className={`btn btn-xs${!category ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => setCategory('')}
          >{t('search.cat_all')}</button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              className={`btn btn-xs${category === cat ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => setCategory(cat)}
            >{t(`search.cat_${cat}`)}</button>
          ))}
        </div>
      </form>

      {error && <p className="search-error">{error}</p>}

      {results && items.length === 0 && (
        <p className="muted">{t('search.no_results')}</p>
      )}

      {items.length > 0 && (
        <div className="search-results">
          <div className="search-results-header">
            <p className="search-count">{t('search.result_count', { count: results.total || items.length })}</p>
            <label className="search-zone-picker">
              <span className="muted small">{t('search.play_on_zone')}</span>
              <select
                value={playZoneId || ''}
                onChange={e => setPlayZoneId(e.target.value)}
              >
                <option value="">{t('search.select_zone')}</option>
                {zoneOptions.map(z => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="search-results-scroll">
          <ul className="search-list">
            {items.map((item, idx) => {
              const key = item.item_key || idx;
              const fb = playFeedback[item.item_key];
              const playable = PLAYABLE_HINTS.has(item.hint);
              const isPlaying = playing === item.item_key;
              return (
                <li key={key} className="search-item">
                  {item.image_key && (
                    <img
                      className="search-item-thumb"
                      src={`/api/roon/image/${item.image_key}?w=40&h=40`}
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
                        {fb.ok ? '▶' : '⚠'} {fb.message}
                      </span>
                    )}
                  </div>
                  {item.hint && (
                    <span className={`badge badge-sm search-hint-badge hint-${item.hint}`}>
                      {t(`search.hint_${item.hint}`, { defaultValue: item.hint })}
                    </span>
                  )}
                  {playable && item.item_key && (
                    <button
                      type="button"
                      className="btn btn-xs btn-primary search-play-btn"
                      onClick={() => handlePlay(item.item_key)}
                      disabled={isPlaying || !playZoneId}
                      title={!playZoneId ? t('search.play_pick_zone') : t('search.play_now_tip')}
                    >
                      {isPlaying ? '…' : `▶ ${t('search.play_now')}`}
                    </button>
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
