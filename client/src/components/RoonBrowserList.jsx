import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The list part of a Roon browser (search results or library browsing): breadcrumb, zone
 * picker, items with drill-in or play buttons, paging, text prompts and the action menu.
 *
 * Props:
 *   browser       — state and actions from useRoonBrowser
 *   zoneOptions   — [{ id, name }]
 *   playZoneId, onPlayZoneChange
 *   filter(items) — optional, e.g. hide empty search results
 *   headerExtra   — optional controls next to the result count
 */
export default function RoonBrowserList({ browser, zoneOptions, playZoneId, onPlayZoneChange, filter, headerExtra }) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState(null); // { itemKey, value }
  const { navStack, current, loading, playing, playFeedback, actionMenu, menuAnchor, menuRef } = browser;
  const items = current?.items || [];
  const listMeta = current?.listMeta || null;
  const shown = filter ? filter(items) : items;
  const more = listMeta?.count != null && items.length < listMeta.count;

  function openItem(item) {
    if (item.input_prompt) {
      setPrompt({ itemKey: item.item_key, value: item.input_prompt.value || '' });
      return;
    }
    browser.drillIn(item);
  }

  return (
    <>
      {browser.message && <p className="muted small search-message" role="status">{browser.message}</p>}

      {navStack.length > 0 && (
        <div className="search-results">
          {navStack.length > 1 && (
            <div className="search-breadcrumb">
              {navStack.map((level, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="search-breadcrumb-sep">›</span>}
                  <button
                    className={`search-breadcrumb-item${idx === navStack.length - 1 ? ' active' : ''}`}
                    onClick={() => browser.back(idx)}
                    disabled={idx === navStack.length - 1 || loading}
                  >
                    {level.title}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

          <div className="search-results-header">
            {listMeta?.count != null && (
              <p className="search-count">{t('search.result_count', { count: listMeta.count })}</p>
            )}
            {headerExtra}
            <label className="search-zone-picker">
              <span className="muted small">{t('search.play_on_zone')}</span>
              <select value={playZoneId || ''} onChange={e => onPlayZoneChange(e.target.value)}>
                <option value="">{t('search.select_zone')}</option>
                {zoneOptions.map(z => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </label>
          </div>

          {items.length === 0 && !loading && <p className="muted">{t('search.no_results')}</p>}

          <div className="search-results-scroll">
            <ul className="search-list">
              {shown.map((item, idx) => {
                const key = item.item_key || `item-${idx}`;
                const fb = playFeedback[item.item_key];
                const isHeader = item.hint === 'header';
                const isDrillable = item.hint === 'list' && item.item_key;
                const isPlayable = (item.hint === 'action_list' || item.hint === 'action') && item.item_key;
                const prompting = prompt && prompt.itemKey === item.item_key;

                return (
                  <li
                    key={key}
                    className={[
                      'search-item',
                      isHeader ? 'search-item-header' : '',
                      isDrillable ? 'search-item-drillable' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={isDrillable && !prompting ? () => openItem(item) : undefined}
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
                      {item.subtitle && <span className="search-item-sub">{item.subtitle}</span>}
                      {prompting && (
                        <form
                          className="search-prompt"
                          onClick={e => e.stopPropagation()}
                          onSubmit={e => {
                            e.preventDefault();
                            const value = prompt.value.trim();
                            setPrompt(null);
                            if (value) browser.drillIn(item, value);
                          }}
                        >
                          <input
                            autoFocus
                            className="search-input"
                            type={item.input_prompt.is_password ? 'password' : 'text'}
                            placeholder={item.input_prompt.prompt}
                            aria-label={item.input_prompt.prompt}
                            value={prompt.value}
                            onChange={e => setPrompt({ ...prompt, value: e.target.value })}
                          />
                          <button type="submit" className="btn btn-primary btn-sm">{item.input_prompt.action || t('search.search_btn')}</button>
                        </form>
                      )}
                      {fb && (
                        <span className={`small search-play-feedback ${fb.ok ? 'text-success' : 'text-error'}`}>
                          {fb.ok ? '✓' : '⚠'} {fb.message || t('search.no_actions')}
                        </span>
                      )}
                    </div>

                    {isDrillable && (
                      <button
                        type="button"
                        className="btn btn-ghost search-drill-btn"
                        onClick={e => { e.stopPropagation(); openItem(item); }}
                        disabled={loading}
                        title={t('search.drill_in')}
                      >›</button>
                    )}

                    {isPlayable && (
                      <div className="search-play-wrap">
                        <button
                          type="button"
                          className={`btn btn-xs search-play-btn${actionMenu?.itemKey === item.item_key ? ' btn-ghost' : ' btn-primary'}`}
                          onClick={(e) => browser.openActions(item, e.currentTarget, t('search.play_pick_zone'))}
                          disabled={playing === item.item_key || !playZoneId}
                          title={!playZoneId ? t('search.play_pick_zone') : t('search.play_now_tip')}
                        >
                          {playing === item.item_key ? '…' : '▶'}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {more && (
              <button type="button" className="btn btn-ghost btn-sm search-more" onClick={browser.loadMore} disabled={loading}>
                {loading ? '…' : t('browse.load_more', { shown: items.length, count: listMeta.count })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Action menu — fixed outside the scroll container to avoid clipping */}
      {actionMenu && menuAnchor && (
        <div
          ref={menuRef}
          className="search-action-menu"
          style={{ position: 'fixed', top: menuAnchor.top, right: menuAnchor.right }}
        >
          {actionMenu.actions.map(action => (
            <button
              key={action.item_key}
              type="button"
              className="search-action-item"
              onClick={() => browser.executeAction(actionMenu.itemKey, action)}
            >
              {action.title}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
