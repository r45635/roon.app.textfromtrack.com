import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

export default function FilesManagement() {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('files-management', false);
  const [embedDefault, setEmbedDefault] = useState(false);
  const [backupDefault, setBackupDefault] = useState(true);
  const [saveLrcBesideDefault, setSaveLrcBesideDefault] = useState(false);
  const [status, setStatus] = useState(null); // 'saving' | 'saved' | null

  useEffect(() => {
    fetch('/api/music/config')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setEmbedDefault(!!data.embed_lyrics_default);
          setBackupDefault(data.backup_before_embed_default !== false);
          setSaveLrcBesideDefault(!!data.save_lrc_beside_source_default);
        }
      })
      .catch(() => {});
  }, []);

  async function save(patch) {
    setStatus('saving');
    try {
      await fetch('/api/music/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setStatus('saved');
      setTimeout(() => setStatus(null), 1800);
    } catch {
      setStatus(null);
    }
  }

  function handleEmbed(v) {
    setEmbedDefault(v);
    save({ embed_lyrics_default: v, backup_before_embed_default: v ? backupDefault : false });
  }

  function handleBackup(v) {
    setBackupDefault(v);
    save({ backup_before_embed_default: v });
  }

  function handleSaveLrc(v) {
    setSaveLrcBesideDefault(v);
    save({ save_lrc_beside_source_default: v });
  }

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('settings.files_mgmt_title', 'Files Management')}</h2>
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

            <label className="embed-toggle settings-embed-toggle">
              <input
                type="checkbox"
                checked={embedDefault}
                onChange={e => handleEmbed(e.target.checked)}
              />
              <span>{t('settings.embed_lyrics_default')}</span>
            </label>
            <p className="muted small">{t('settings.embed_lyrics_default_hint')}</p>

            <label className="embed-toggle settings-embed-toggle">
              <input
                type="checkbox"
                checked={backupDefault}
                disabled={!embedDefault}
                onChange={e => handleBackup(e.target.checked)}
              />
              <span>{t('settings.backup_before_embed_default')}</span>
            </label>
            <p className="muted small">{t('settings.backup_before_embed_default_hint')}</p>

            <label className="embed-toggle settings-embed-toggle">
              <input
                type="checkbox"
                checked={saveLrcBesideDefault}
                onChange={e => handleSaveLrc(e.target.checked)}
              />
              <span>{t('settings.save_lrc_beside_source_default')}</span>
            </label>
            <p className="muted small">{t('settings.save_lrc_beside_source_default_hint')}</p>

            {status === 'saving' && (
              <p className="muted small" style={{ color: 'var(--tft-ink-3)' }}>Saving…</p>
            )}
            {status === 'saved' && (
              <p className="muted small" style={{ color: 'var(--tft-green, #4caf50)' }}>✓ Saved</p>
            )}

          </div>
        </div>
      )}
    </section>
  );
}
