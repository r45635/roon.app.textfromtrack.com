import { useState, useEffect, useCallback } from 'react';

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

/**
 * Lyrics of the track a zone is playing, from GET /api/lyrics/current — works with or
 * without a music folder. Refetches when the track, the picked file or refreshKey changes.
 *
 * @param {object|null} np        now-playing state (zone_id, title, artist, album)
 * @param {{ path?: string|null, refreshKey?: number }} [opts] path = file picked by the user
 * @returns {{ status: 'idle'|'loading'|'ready'|'error', data: object|null, error: string|null,
 *   reload: Function, setOffset: Function, choose: Function }}
 */
export function useTrackLyrics(np, { path = null, refreshKey = 0 } = {}) {
  const [state, setState] = useState({ status: 'idle', key: null, data: null, error: null });
  const [reloadTick, setReloadTick] = useState(0);

  const hasTrack = !!(np && np.title && np.artist);
  const key = hasTrack
    ? [np.zone_id, np.title, np.artist, np.album, path || '', refreshKey].join('||')
    : null;

  useEffect(() => {
    if (!key) {
      setState({ status: 'idle', key: null, data: null, error: null });
      return undefined;
    }
    const ctrl = new AbortController();
    // Keep showing the current lyrics while reloading the same track (offset, save, retry).
    setState(s => ({ status: 'loading', key, data: s.key === key ? s.data : null, error: null }));
    const qs = new URLSearchParams();
    if (np.zone_id) qs.set('zone_id', np.zone_id);
    if (path) qs.set('path', path);
    fetch(`/api/lyrics/current?${qs.toString()}`, { signal: ctrl.signal })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || !d.success) throw new Error(d.error?.message || 'Request failed');
        setState({ status: 'ready', key, data: d, error: null });
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setState({ status: 'error', key, data: null, error: err.message });
      });
    return () => ctrl.abort();
    // np fields are part of `key`, so `key` is the only dependency needed.
  }, [key, reloadTick]);

  const reload = useCallback(() => setReloadTick(n => n + 1), []);

  // LRCLIB was down or busy: the backend retries after its 60 s error memo, so ask again then.
  const lyricsError = state.status === 'ready' && state.data?.lyrics?.error;
  useEffect(() => {
    if (!lyricsError) return undefined;
    const id = setTimeout(reload, 65_000);
    return () => clearTimeout(id);
  }, [lyricsError, reload, state.data]);

  const track = hasTrack ? { title: np.title, artist: np.artist, album: np.album || null } : null;

  const patchLyrics = (patch) => setState(s => (
    s.data ? { ...s, data: { ...s.data, lyrics: { ...s.data.lyrics, ...patch } } } : s
  ));

  /** Save the timing offset (ms, positive = later). Applied locally at once. */
  const setOffset = useCallback(async (offsetMs) => {
    if (!track) return;
    patchLyrics({ offset_ms: offsetMs });
    const res = await postJson('/api/lyrics/offset', { ...track, offset_ms: offsetMs });
    patchLyrics({ offset_ms: res.offset_ms });
  }, [key]);

  /** Use one LRCLIB record for this track from now on. */
  const choose = useCallback(async (lrclibId) => {
    if (!track) return;
    const res = await postJson('/api/lyrics/choose', { ...track, lrclib_id: lrclibId });
    patchLyrics(res.lyrics);
  }, [key]);

  return { status: state.status, data: state.data, error: state.error, reload, setOffset, choose };
}
