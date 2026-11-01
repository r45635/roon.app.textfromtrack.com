import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';
import { maskServerUrl } from '../lib/privacy.js';

// The ordered list of LRCLIB servers: lrclib.net and/or mirrors (same API, a copy of its database).
export default function LyricsSources() {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('lyrics-sources', true);
  const [urls, setUrls] = useState([]);
  const [source, setSource] = useState(null); // 'user_settings' | 'env' | 'default'
  const [newUrl, setNewUrl] = useState('');
  const [tests, setTests] = useState({}); // url -> 'testing' | { ok, ms, error }
  const [status, setStatus] = useState(null); // 'saving' | 'saved' | 'error' | null
  const [error, setError] = useState(null);

  function apply(data) {
    setUrls(data.urls || []);
    setSource(data.source || null);
  }

  useEffect(() => {
    fetch('/api/lyrics-sources')
      .then(r => r.json())
      .then(data => { if (data.success) apply(data); else setStatus('error'); })
      .catch(() => setStatus('error'));
  }, []);

  // Resolves true when the server stored the list; an invalid entry comes back with its reason.
  async function save(next) {
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/lyrics-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatus(null);
        setError(data.error?.message || `HTTP ${res.status}`);
        return false;
      }
      apply(data);
      setStatus('saved');
      setTimeout(() => setStatus(null), 1800);
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }

  async function handleAdd() {
    const value = newUrl.trim();
    if (!value) return;
    if (await save([...urls, value])) setNewUrl('');
  }

  function move(idx, delta) {
    const next = [...urls];
    const [item] = next.splice(idx, 1);
    next.splice(idx + delta, 0, item);
    save(next);
  }

  async function test(url) {
    setTests(prev => ({ ...prev, [url]: 'testing' }));
    try {
      const res = await fetch('/api/lyrics-sources/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      const result = data.success ? data : { ok: false, error: data.error?.message || `HTTP ${res.status}` };
      setTests(prev => ({ ...prev, [url]: result }));
    } catch (err) {
      setTests(prev => ({ ...prev, [url]: { ok: false, error: err.message } }));
    }
  }

  const hasLrclib = urls.some(u => /^https?:\/\/lrclib\.net(\/|$)/.test(u));

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('lyrics_sources.title')}</h2>
        <button
          className="collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? t('common.expand') : t('common.collapse')}
        >
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      {!collapsed && (
        <div className="card-body">
          <div className="settings-body">
            <p className="muted small">{t('lyrics_sources.hint')}</p>

            <ol className="settings-roots-list lyrics-sources-list">
              {urls.map((url, idx) => {
                const result = tests[url];
                return (
                  <li key={url} className="settings-root-item">
                    <span className="settings-root-path">{maskServerUrl(url)}</span>
                    {result === 'testing' && <span className="muted small">{t('lyrics_sources.testing')}</span>}
                    {result && result !== 'testing' && (result.ok
                      ? <span className="small settings-status-ok">{t('lyrics_sources.test_ok', { ms: result.ms })}</span>
                      : <span className="small settings-status-error" title={result.error}>{t('lyrics_sources.test_failed')}</span>)}
                    <button className="btn btn-ghost btn-sm" onClick={() => test(url)} disabled={result === 'testing'}>
                      {t('lyrics_sources.test')}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      title={t('lyrics_sources.move_up')}
                      aria-label={t('lyrics_sources.move_up')}
                    >↑</button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => move(idx, 1)}
                      disabled={idx === urls.length - 1}
                      title={t('lyrics_sources.move_down')}
                      aria-label={t('lyrics_sources.move_down')}
                    >↓</button>
                    <button
                      className="btn btn-ghost btn-sm settings-remove-btn"
                      onClick={() => save(urls.filter((_, i) => i !== idx))}
                      title={t('settings.remove')}
                      aria-label={t('settings.remove')}
                    >✕</button>
                  </li>
                );
              })}
            </ol>
            {Object.entries(tests).filter(([url, r]) => urls.includes(url) && r && r !== 'testing' && !r.ok).map(([url, r]) => (
              <p key={url} className="settings-error">{maskServerUrl(url)} — {r.error}</p>
            ))}

            <div className="settings-add-row">
              <input
                className="settings-path-input"
                type="url"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                placeholder={t('lyrics_sources.add_placeholder')}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
              <button className="btn btn-secondary btn-sm" onClick={handleAdd} disabled={!newUrl.trim()}>
                {t('settings.add_path')}
              </button>
            </div>
            {error && <p className="settings-error" role="alert">{error}</p>}

            {!hasLrclib && urls.length > 0 && (
              <p className="muted small">{t('lyrics_sources.no_lrclib_warning')}</p>
            )}
            {source === 'env' && <p className="muted small">{t('lyrics_sources.from_env')}</p>}
            <p className="muted small">{t('lyrics_sources.privacy')}</p>
            <p className="muted small">
              {t('lyrics_sources.mirror_help')}{' '}
              <a href="https://github.com/tranxuanthang/lrclib" target="_blank" rel="noreferrer">
                {t('lyrics_sources.mirror_link')}
              </a>
            </p>

            {source === 'user_settings' && (
              <button className="btn btn-ghost btn-sm" onClick={() => save([])}>
                {t('lyrics_sources.reset')}
              </button>
            )}

            {status === 'saving' && <p className="muted small">{t('settings.saving')}</p>}
            {status === 'saved' && <p className="muted small settings-status-ok">{t('settings.saved')}</p>}
            {status === 'error' && (
              <p className="muted small settings-status-error" role="alert">{t('settings.save_failed')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
