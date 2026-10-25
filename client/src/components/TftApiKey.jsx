import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollapsed } from '../hooks/useCollapsed.js';
import { describeError } from '../lib/errors.js';
import { maskAccount } from '../lib/privacy.js';

export default function TftApiKey({ onTokenSaved }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapsed('tft-api-key', false);

  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [tokenSource, setTokenSource] = useState('none'); // 'env' | 'user_settings' | 'none'
  const [inputValue, setInputValue] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // 'ok' | 'error'
  const [error, setError] = useState(null);
  // Result of asking TextFromTrack about the stored key:
  // null (not checked) | 'checking' | { valid, email, credits, top_up_url } | { unreachable: msg }
  const [check, setCheck] = useState(null);

  async function verifyKey() {
    setCheck('checking');
    try {
      const res = await fetch('/api/tft/me');
      const data = await res.json();
      if (!res.ok || data.success === false) throw Object.assign(new Error(data.error?.message || `HTTP ${res.status}`), { code: data.error?.code });
      if (!data.token_configured) { setCheck(null); return; }
      setCheck({
        valid: data.token_valid !== false,
        email: maskAccount(data).email,
        credits: data.credit_available ?? data.credit_balance,
        top_up_url: data.top_up_url,
      });
    } catch (err) {
      setCheck({ unreachable: describeError(err) });
    }
  }

  useEffect(() => {
    fetch('/api/tft/config')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setTokenConfigured(data.token_configured);
          setTokenSource(data.token_source || 'none');
          if (data.token_configured) verifyKey();
        }
      })
      .catch(() => {});
  }, []);

  // value: the key to store; '' removes the saved key.
  async function handleSave(value = inputValue) {
    setSaving(true);
    setSaveResult(null);
    setError(null);
    try {
      const res = await fetch('/api/tft/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tft_token: value }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Save failed');
      setTokenConfigured(data.token_configured);
      setTokenSource(data.token_configured ? 'user_settings' : 'none');
      setInputValue('');
      setShowToken(false);
      setSaveResult('ok');
      if (onTokenSaved) onTokenSaved();
      if (data.token_configured) verifyKey();
      else setCheck(null);
      setTimeout(() => setSaveResult(null), 3000);
    } catch (err) {
      setError(err.message);
      setSaveResult('error');
    } finally {
      setSaving(false);
    }
  }

  const isEnvFallback = tokenSource === 'env';

  return (
    <section className={`card${collapsed ? ' collapsed' : ''}`}>
      <div className="card-header">
        <h2>{t('tft_key.title', 'TextFromTrack API Key')}</h2>
        <button className="collapse-btn" onClick={toggleCollapsed} title={collapsed ? t('common.expand') : t('common.collapse')}>
          {collapsed ? '▶' : '▼'}
        </button>
      </div>

      {!collapsed && (
        <div className="card-body">
          <div className="settings-body">

            {/* Status badge */}
            <div className="app-pref-row" style={{ alignItems: 'center' }}>
              <span className="settings-label">{t('tft_key.status', 'API Key')}</span>
              <span className={`badge ${tokenConfigured ? 'badge-success' : 'badge-error'}`}
                style={{ marginLeft: 8 }}>
                {tokenConfigured
                  ? t('tft_key.configured', '✓ Configured')
                  : t('tft_key.not_configured', '✗ Not set')}
              </span>
              {isEnvFallback && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--tft-ink-3)' }}>
                  {t('tft_key.env_fallback', '(from .env — enter a key below to override)')}
                </span>
              )}
            </div>

            {/* Hint */}
            <p style={{ fontSize: 12, color: 'var(--tft-ink-3)', margin: '4px 0 10px' }}>
              {t('tft_key.hint', 'Get your key at')}{' '}
              <a
                href="https://app.textfromtrack.com"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--tft-brand)' }}
              >
                app.textfromtrack.com ↗
              </a>
            </p>

            {/* Token input */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 200px' }}>
                <input
                  type={showToken ? 'text' : 'password'}
                  className="app-pref-num"
                  style={{ width: '100%', paddingRight: 32, fontFamily: 'monospace', fontSize: 12, textAlign: 'left' }}
                  placeholder={tokenConfigured
                    ? t('tft_key.placeholder_replace', 'Enter new key to replace…')
                    : t('tft_key.placeholder_enter', 'Paste your API key here…')}
                  value={inputValue}
                  onChange={e => { setInputValue(e.target.value); setSaveResult(null); }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(v => !v)}
                  title={showToken ? t('tft_key.hide', 'Hide') : t('tft_key.show', 'Show')}
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--tft-ink-3)', fontSize: 14, padding: '0 2px',
                  }}
                >
                  {showToken ? '🙈' : '👁'}
                </button>
              </div>

              <button
                className="tft-round-btn"
                style={{ height: 30, padding: '0 14px', fontSize: 12, borderRadius: 6, whiteSpace: 'nowrap' }}
                disabled={saving || !inputValue.trim()}
                onClick={() => handleSave()}
              >
                {saving ? t('tft_key.saving', 'Saving…') : t('tft_key.save', 'Save')}
              </button>

              {tokenSource === 'user_settings' && (
                <button
                  className="tft-round-btn"
                  style={{ height: 30, padding: '0 14px', fontSize: 12, borderRadius: 6, whiteSpace: 'nowrap', color: 'var(--tft-red, #e55)' }}
                  disabled={saving}
                  onClick={() => { setInputValue(''); handleSave(''); }}
                  title={t('tft_key.clear_title', 'Remove the saved API key')}
                >
                  {t('tft_key.clear', 'Remove key')}
                </button>
              )}
            </div>

            {/* Feedback */}
            {saveResult === 'ok' && (
              <p style={{ fontSize: 12, color: 'var(--tft-green, #4caf50)', marginTop: 6 }}>
                ✓ {t('tft_key.saved_ok', 'Key saved successfully')}
              </p>
            )}
            {tokenConfigured && check && (
              <p className={`tft-key-check${check.valid ? ' ok' : check === 'checking' ? '' : ' bad'}`} role="status">
                {check === 'checking' ? t('tft_key.checking')
                  : check.unreachable ? t('tft_key.check_unreachable', { msg: check.unreachable })
                  : !check.valid ? t('tft_key.check_invalid')
                  : t('tft_key.check_ok', { email: check.email || '?', count: check.credits ?? 0 })}
                {check.valid && check.credits === 0 && check.top_up_url && (
                  <> · <a href={check.top_up_url} target="_blank" rel="noreferrer">{t('app.top_up')}</a></>
                )}
              </p>
            )}
            {saveResult === 'error' && error && (
              <p style={{ fontSize: 12, color: 'var(--tft-red, #e55)', marginTop: 6 }}>{error}</p>
            )}

          </div>
        </div>
      )}
    </section>
  );
}
