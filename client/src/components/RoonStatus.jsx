import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

export default function RoonStatus({ data }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('roon-status');

  const connected = data?.connected ?? false;
  const authorized = data?.authorized ?? false;
  const coreName = data?.core_name;
  const zoneCount = data?.zone_count ?? 0;

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('section.roon_connection')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      <div className="card-body">
        <div className="status-grid">
          <div className="status-row">
            <span className="label">{t('roon.core_status')}</span>
            <span className={`badge ${connected ? 'badge-success' : 'badge-error'}`}>
              {connected ? t('roon.connected') : t('roon.disconnected')}
            </span>
          </div>

          <div className="status-row">
            <span className="label">{t('roon.extension_status')}</span>
            <span className={`badge ${authorized ? 'badge-success' : 'badge-warning'}`}>
              {authorized ? t('roon.authorized') : t('roon.not_authorized')}
            </span>
          </div>

          {coreName && (
            <div className="status-row">
              <span className="label">{t('roon.core_name')}</span>
              <span className="value">{coreName}</span>
            </div>
          )}

          <div className="status-row">
            <span className="label">{t('roon.active_zone')}</span>
            <span className="value">
              {zoneCount > 0 ? `${zoneCount} zone${zoneCount > 1 ? 's' : ''}` : t('roon.no_zone')}
            </span>
          </div>
        </div>

        {!authorized && (
          <div className="alert alert-info">
            {t('roon.authorize_prompt')}{' '}
            <strong>{t('roon.authorize_extension')}</strong>
          </div>
        )}
      </div>
    </section>
  );
}
