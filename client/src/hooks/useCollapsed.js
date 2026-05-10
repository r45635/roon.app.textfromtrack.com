import { useState, useCallback } from 'react';

const PREFIX = 'card-collapsed:';

/**
 * Collapse state persisted in localStorage.
 * @param {string} key              - unique card identifier
 * @param {boolean} [defaultCollapsed=false]
 * @returns {[boolean, () => void]}
 */
export function useCollapsed(key, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(PREFIX + key);
      return stored !== null ? stored === 'true' : defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem(PREFIX + key, String(next)); } catch { /* storage blocked */ }
      return next;
    });
  }, [key]);

  return [collapsed, toggle];
}
