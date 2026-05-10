import React, { useState, useEffect } from 'react';
import { useCollapsed } from '../hooks/useCollapsed.js';
import { useTranslation } from 'react-i18next';

export default function LibrarySettings({ onRescanStarted }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('library-settings');
  const [roots, setRoots] = useState([]);
  const [newPath, setNewPath] = useState('');
  const [embedDefault, setEmbedDefault] = useState(false);
  const [backupDefault, setBackupDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/music/config')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setRoots(data.music_roots || []);
          setEmbedDefault(!!data.embed_lyrics_default);
          setBackupDefault(data.backup_before_embed_default !== false);
        }
      })
      .catch(() => setError('Failed to load library config'));
  }, []);

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
          embed_lyrics_default: embedDefault,
          backup_before_embed_default: backupDefault,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) throw new Error(saveData.error?.message || 'Save failed');

      const scanRes = await fetch('/api/music/index/rescan', { method: 'POST' });
      const scanData = await scanRes.json();
      if (!scanData.success) throw new Error(scanData.error?.message || 'Rescan failed');

      if (onRescanStarted) onRescanStarted();
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
                <span className="settings-root-path">{root}</span>
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

        <label className="embed-toggle settings-embed-toggle">
          <input
            type="checkbox"
            checked={embedDefault}
            onChange={e => setEmbedDefault(e.target.checked)}
          />
          <span>{t('settings.embed_lyrics_default')}</span>
        </label>
        <p className="muted small">{t('settings.embed_lyrics_default_hint')}</p>

        <label className="embed-toggle settings-embed-toggle">
          <input
            type="checkbox"
            checked={backupDefault}
            disabled={!embedDefault}
            onChange={e => setBackupDefault(e.target.checked)}
          />
          <span>{t('settings.backup_before_embed_default')}</span>
        </label>
        <p className="muted small">{t('settings.backup_before_embed_default_hint')}</p>

        {error && <p className="settings-error">{error}</p>}

        <button
          className="btn btn-primary settings-save-btn"
          onClick={handleSaveRescan}
          disabled={saving}
        >{saving ? '…' : t('settings.save_rescan')}</button>
      </div>
      </div>
    </section>
  );
}
