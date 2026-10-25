import React, { useState, useEffect, useCallback } from 'react';
import { useCollapsed } from '../hooks/useCollapsed.js';
import { useTranslation } from 'react-i18next';
import { maskPath } from '../lib/privacy.js';

export default function LibrarySettings({ onRescanStarted }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('library-settings');
  const [roots, setRoots] = useState([]);
  const [newPath, setNewPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null); // GET /api/music/index/status

  const loadStatus = useCallback(async () => {
    try {
      const data = await (await fetch('/api/music/index/status')).json();
      if (data.success) setStatus(data);
    } catch { /* shown as unknown */ }
  }, []);

  useEffect(() => {
    fetch('/api/music/config')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setRoots(data.music_roots || []);
        }
      })
      .catch(() => setError(t('settings.load_failed')));
    loadStatus();
  }, [loadStatus]);

  // Follow a running scan.
  const scanning = !!status?.scan_in_progress;
  useEffect(() => {
    if (!scanning) return undefined;
    const id = setInterval(loadStatus, 1500);
    return () => clearInterval(id);
  }, [scanning, loadStatus]);

  function handleAdd() {
    const trimmed = newPath.trim();
    if (!trimmed || roots.includes(trimmed)) return;
    setRoots(prev => [...prev, trimmed]);
    setNewPath('');
  }

  function handleRemove(idx) {
    setRoots(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSaveRescan() {
    setSaving(true);
    setError(null);
    try {
      const saveRes = await fetch('/api/music/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          music_roots: roots,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) throw new Error(saveData.error?.message || 'Save failed');
      // No folder left: lyrics-only mode, nothing to scan.
      if (roots.length === 0) {
        await loadStatus();
        return;
      }

      const scanRes = await fetch('/api/music/index/rescan', { method: 'POST' });
      const scanData = await scanRes.json();
      if (!scanData.success) throw new Error(scanData.error?.message || 'Rescan failed');

      if (onRescanStarted) onRescanStarted();
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('settings.library_title')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      <div className="card-body">
      <div className="settings-body">
        <label className="settings-label">{t('settings.music_roots')}</label>

        {roots.length === 0 ? (
          <p className="muted settings-no-roots">{t('settings.no_roots')}</p>
        ) : (
          <ul className="settings-roots-list">
            {roots.map((root, idx) => (
              <li key={idx} className="settings-root-item">
                <span className="settings-root-path">{maskPath(root)}</span>
                <button
                  className="btn btn-ghost btn-sm settings-remove-btn"
                  onClick={() => handleRemove(idx)}
                  title={t('settings.remove')}
                  aria-label={t('settings.remove')}
                >✕</button>
              </li>
            ))}
          </ul>
        )}

        <div className="settings-add-row">
          <input
            className="settings-path-input"
            type="text"
            value={newPath}
            onChange={e => setNewPath(e.target.value)}
            placeholder={t('settings.add_path_placeholder')}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleAdd}
            disabled={!newPath.trim()}
          >{t('settings.add_path')}</button>
        </div>

        {status && roots.length > 0 && <ScanStatus status={status} />}

        {error && <p className="settings-error">{error}</p>}

        <button
          className="btn btn-primary settings-save-btn"
          onClick={handleSaveRescan}
          disabled={saving}
        >{saving ? '…' : roots.length ? t('settings.save_rescan') : t('settings.save_no_folder')}</button>
      </div>
      </div>
    </section>
  );
}

function ScanStatus({ status }) {
  const { t, i18n } = useTranslation();
  const missing = (status.roots || []).filter(r => !r.exists);
  const last = status.scan?.last || {};
  return (
    <div className="settings-scan-status" role="status">
      {status.scan_in_progress ? (
        <p>{t('settings.scan_running', { count: status.scan?.progress?.scanned ?? 0 })}</p>
      ) : status.last_scan_at ? (
        <p>
          {t('settings.scan_summary', {
            count: status.track_count ?? 0,
            date: new Date(status.last_scan_at).toLocaleString(i18n.language),
          })}
          {last.error_count > 0 && ` · ${t('settings.scan_unreadable', { count: last.error_count })}`}
        </p>
      ) : (
        <p>{t('settings.scan_never')}</p>
      )}
      {last.error && <p className="settings-error">{t('settings.scan_failed', { msg: last.error })}</p>}
      {missing.map(r => (
        <p key={r.path} className="settings-error">{t('settings.root_missing', { path: maskPath(r.path) })}</p>
      ))}
    </div>
  );
}
