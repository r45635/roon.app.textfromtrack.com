import { useState, useRef, useEffect } from 'react';

const PAGE = 100;
const SESSION_KEY = 'tft:browseSession';

// One Roon browse session per browser tab: without it every viewer of the backend shares the
// same Roon navigation state, and one viewer's drill-in moves the other's list.
function sessionKey() {
  try {
    let key = sessionStorage.getItem(SESSION_KEY);
    if (!key) {
      key = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
      sessionStorage.setItem(SESSION_KEY, key);
    }
    return key;
  } catch {
    return 'tab';
  }
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data;
}

/**
 * Navigation in one Roon browse hierarchy ('search', 'browse', …): levels, paging, the
 * action menu of playable items, and Roon's session kept at the level on screen.
 *
 * @param {string} hierarchy
 * @param {{ zoneId: string }} opts zone used for drill-ins and actions
 */
export function useRoonBrowser(hierarchy, { zoneId }) {
  // navStack: [{ title, itemKey, items, listMeta }] — listMeta.level is Roon's level number
  const [navStack, setNavStack] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null); // a non-error message from Roon
  const [playing, setPlaying] = useState(null);
  const [playFeedback, setPlayFeedback] = useState({});
  const [actionMenu, setActionMenu] = useState(null); // { itemKey, actions } | null
  const [menuAnchor, setMenuAnchor] = useState(null);
  const menuRef = useRef(null);
  // Level Roon's session is at: deeper than the screen after an action list was opened.
  const roonLevel = useRef(0);
  const multiSessionKey = useRef(sessionKey());

  useEffect(() => {
    if (!actionMenu) return;
    function onMouseDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [actionMenu]);

  function closeMenu() {
    setActionMenu(null);
    setMenuAnchor(null);
  }

  function reset() {
    setError(null); setMessage(null); setPlayFeedback({}); closeMenu();
  }

  const base = () => ({ hierarchy, multi_session_key: multiSessionKey.current });

  // One browse step. Returns { items, listMeta } for a list, { message } for a message,
  // null for anything else. Throws on a Roon error message.
  async function step(opts) {
    const br = await post('/api/roon/browse', { ...base(), ...opts });
    if (br.action === 'message') {
      if (br.is_error) throw new Error(br.message || 'Roon error');
      return { message: br.message || null };
    }
    if (br.action !== 'list') return null;
    if (br.list && Number.isInteger(br.list.level)) roonLevel.current = br.list.level;
    const ld = await post('/api/roon/browse/load', { ...base(), count: PAGE });
    return { items: ld.items || [], listMeta: ld.list || br.list || null };
  }

  // Bring Roon's session back to the level on screen before using one of its item keys.
  async function syncTo(level) {
    if (level == null || roonLevel.current <= level) return;
    await post('/api/roon/browse', { ...base(), pop_levels: roonLevel.current - level });
    roonLevel.current = level;
  }

  const current = navStack.length ? navStack[navStack.length - 1] : null;

  /** Start over at the top of the hierarchy (opts: e.g. { input } for search). */
  async function open(title, opts = {}) {
    setLoading(true); reset();
    try {
      const result = await step({ pop_all: true, ...opts });
      if (!result || !result.items) {
        setNavStack([]);
        if (result?.message) setMessage(result.message);
        return;
      }
      setNavStack([{ title: title || result.listMeta?.title || '', itemKey: null, ...result }]);
    } catch (err) {
      setError(err.message); setNavStack([]);
    } finally {
      setLoading(false);
    }
  }

  /** Open a list item; input answers its input_prompt, if it has one. */
  async function drillIn(item, input) {
    setLoading(true); reset();
    try {
      await syncTo(current?.listMeta?.level);
      const result = await step({
        item_key: item.item_key,
        zone_or_output_id: zoneId || undefined,
        ...(input != null ? { input } : {}),
      });
      if (!result) return;
      if (result.message) { setMessage(result.message); return; }
      setNavStack(prev => [...prev, { title: item.title, itemKey: item.item_key, ...result }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /** Go back to a level of the breadcrumb, moving Roon's session up with it. */
  async function back(idx) {
    const target = navStack[idx];
    if (!target || idx === navStack.length - 1) return;
    setLoading(true); reset();
    try {
      const level = target.listMeta?.level;
      if (level != null && roonLevel.current > level) {
        await post('/api/roon/browse', { ...base(), pop_levels: roonLevel.current - level });
        roonLevel.current = level;
        const ld = await post('/api/roon/browse/load', { ...base(), count: PAGE });
        setNavStack(prev => [...prev.slice(0, idx), { ...target, items: ld.items || [], listMeta: ld.list || target.listMeta }]);
      } else {
        setNavStack(prev => prev.slice(0, idx + 1));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /** Load the next page of the list on screen. */
  async function loadMore() {
    if (!current) return;
    setLoading(true); setError(null);
    try {
      const ld = await post('/api/roon/browse/load', {
        ...base(),
        offset: current.items.length,
        count: PAGE,
        ...(current.listMeta?.level != null ? { level: current.listMeta.level } : {}),
      });
      setNavStack(prev => {
        const next = [...prev];
        const top = next[next.length - 1];
        next[next.length - 1] = { ...top, items: [...top.items, ...(ld.items || [])] };
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /** Fetch the Roon actions of a playable item (Play Now, Add Next, Queue, Start Radio…). */
  async function openActions(item, buttonEl, noZoneMessage) {
    if (actionMenu?.itemKey === item.item_key) { closeMenu(); return; }
    if (buttonEl) {
      const rect = buttonEl.getBoundingClientRect();
      setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    if (!zoneId) {
      setPlayFeedback(prev => ({ ...prev, [item.item_key]: { ok: false, message: noZoneMessage } }));
      return;
    }
    setPlaying(item.item_key);
    setPlayFeedback(prev => ({ ...prev, [item.item_key]: null }));
    setActionMenu(null);
    try {
      await syncTo(current?.listMeta?.level);
      const result = await step({ item_key: item.item_key, zone_or_output_id: zoneId });
      let actions = result?.items ? result.items.filter(a => a.hint === 'action' && a.item_key) : [];
      // Some items (e.g. tracks in a flat search) wrap their actions one level deeper.
      if (result?.items && actions.length === 0) {
        const nested = result.items.find(a => a.hint === 'action_list' && a.item_key);
        if (nested) {
          const r2 = await step({ item_key: nested.item_key, zone_or_output_id: zoneId });
          if (r2?.items) actions = r2.items.filter(a => a.hint === 'action' && a.item_key);
        }
      }
      if (result?.message) {
        setPlayFeedback(prev => ({ ...prev, [item.item_key]: { ok: true, message: result.message } }));
      } else if (actions.length === 0) {
        setPlayFeedback(prev => ({ ...prev, [item.item_key]: { ok: false, message: null } }));
      } else {
        setActionMenu({ itemKey: item.item_key, actions });
      }
    } catch (err) {
      setPlayFeedback(prev => ({ ...prev, [item.item_key]: { ok: false, message: err.message } }));
    } finally {
      setPlaying(null);
    }
  }

  /** Run one action from the menu. */
  async function executeAction(parentKey, actionItem) {
    closeMenu();
    setPlaying(parentKey);
    try {
      const data = await post('/api/roon/browse', {
        ...base(), item_key: actionItem.item_key, zone_or_output_id: zoneId,
      });
      if (data.action === 'message' && data.is_error) throw new Error(data.message || 'Roon error');
      setPlayFeedback(prev => ({ ...prev, [parentKey]: { ok: true, message: data.message || actionItem.title } }));
    } catch (err) {
      setPlayFeedback(prev => ({ ...prev, [parentKey]: { ok: false, message: err.message } }));
    } finally {
      setPlaying(null);
    }
  }

  return {
    navStack, current, loading, error, message, playing, playFeedback, actionMenu, menuAnchor, menuRef,
    open, drillIn, back, loadMore, openActions, executeAction, clear: () => { setNavStack([]); reset(); },
  };
}
