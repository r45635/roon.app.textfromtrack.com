import React from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';

const REPO = 'https://github.com/r45635/roon.app.textfromtrack.com';
// Injected by vite.config.js; undefined when the module runs outside a Vite build.
const COMMIT = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : null;
const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : null;

/** Settings → About: version and build, update status, where the project lives. */
export default function AboutCard({ updateInfo }) {
  const { t, i18n } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('about', false);
  const version = updateInfo?.current || null;
  const fr = (i18n.resolvedLanguage || i18n.language || '').startsWith('fr');

  let status;
  if (!updateInfo) status = null;
  else if (!updateInfo.enabled) status = t('about.check_off');
  else if (updateInfo.update_available && updateInfo.url) {
    status = (
      <a href={updateInfo.url} target="_blank" rel="noreferrer">
        {t('app.update_available', { version: updateInfo.latest })}
      </a>
    );
  } else if (updateInfo.latest) status = t('about.up_to_date');
  else status = t('about.check_failed');

  const links = [
    [t('about.repo'), REPO],
    version && [t('about.release_notes'), `${REPO}/releases/tag/v${version}`],
    [t('about.guide'), `${REPO}/blob/main/docs/guide/player${fr ? '.fr' : ''}.md`],
    [t('about.report'), `${REPO}/issues`],
  ].filter(Boolean);

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('about.title')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      {!collapsed && (
        <div className="card-body">
          <div className="settings-body about-body">
            <div className="about-name">{t('app.title')}</div>
            <table className="about-table">
              <tbody>
                <tr>
                  <td>{t('about.version')}</td>
                  <td className="tft-mono">{version ? `v${version}` : '…'}</td>
                </tr>
                {COMMIT && (
                  <tr>
                    <td>{t('about.build')}</td>
                    <td className="tft-mono">
                      {/-dirty$/.test(COMMIT)
                        ? COMMIT
                        : <a href={`${REPO}/commit/${COMMIT}`} target="_blank" rel="noreferrer">{COMMIT}</a>}
                      {BUILD_DATE ? ` · ${BUILD_DATE}` : ''}
                    </td>
                  </tr>
                )}
                {status && (
                  <tr>
                    <td>{t('about.updates')}</td>
                    <td>{status}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <ul className="about-links">
              {links.map(([label, href]) => (
                <li key={href}><a href={href} target="_blank" rel="noreferrer">{label}</a></li>
              ))}
            </ul>
            <p className="about-repo tft-mono">{REPO.replace('https://', '')}</p>

            <p className="about-legal">{t('about.legal')}</p>
          </div>
        </div>
      )}
    </section>
  );
}
