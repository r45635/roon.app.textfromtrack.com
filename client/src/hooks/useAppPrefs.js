import { useState, useCallback } from 'react';

const STORAGE_KEY = 'tft:appPrefs';

const DEFAULTS = {
  volumeStep:  1,      // relative step sent to Roon on each +/- click
  roonPollMs:  1000,   // now-playing refresh interval in ms
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* blocked */ }
}

/**
 * App-level user preferences, persisted in localStorage.
 * Returns [prefs, setPref] where setPref(key, value) updates a single key.
 */
export function useAppPrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);

  const setPref = useCallback((key, value) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value };
      savePrefs(next);
      return next;
    });
  }, []);

  return [prefs, setPref];
}
