'use strict';

/**
 * Looks up the lyrics of the next tracks in a zone's play queue while the current one plays,
 * so they are in the cache when the track changes. Runs for the active zone and for any zone
 * whose queue a viewer opened.
 *
 * Polite to LRCLIB: one track at a time, PAUSE_MS between lookups, tracks already known are
 * skipped, and a cycle stops at the first error (the resolver's memo and the servers'
 * cooldown take over from there). A newer queue or track cancels the running cycle.
 */

const logger = require('../utils/logger');
const lrcCache = require('../utils/lrcCache');
const nowPlayingStore = require('../roon/nowPlayingStore');
const lyricsResolver = require('./lyricsResolver');
const nowPlayingLyrics = require('./nowPlayingLyrics');

const LOOKAHEAD = 3;
const PAUSE_MS = 1000;
const DEBOUNCE_MS = 500;
const SEEN_MAX = 500;

// What a prefetch found, by track: covers local files (sidecar, tags), which peek() can't see.
const _seen = new Map();

function _key(track) {
  return lrcCache.metaId(track.artist, track.title, track.album);
}

function _statusOf(lyrics) {
  if (!lyrics.found) return 'none';
  if (lyrics.instrumental) return 'instrumental';
  return lyrics.synced ? 'synced' : 'plain';
}

/**
 * What is known about a track's lyrics without any lookup.
 * @returns {'synced'|'plain'|'instrumental'|'none'|'unknown'}
 */
function statusOf(track) {
  const known = lyricsResolver.peek(track);
  if (known !== 'unknown') return known;
  return _seen.get(_key(track)) || 'unknown';
}

function _sameTrack(a, b) {
  return a.title === b.title && a.artist === b.artist && (a.album || null) === (b.album || null);
}

/**
 * The next LOOKAHEAD tracks after the playing one. Roon lists the playing track first; if it
 * can't be found in the queue, the first item is still taken as the current one.
 */
function upcoming(queue, np) {
  const idx = queue.findIndex(item => _sameTrack(item, np));
  const start = idx >= 0 ? idx + 1 : 1;
  return queue.slice(start, start + LOOKAHEAD);
}

/**
 * @param {object} roon roonClient (getNowPlaying, getQueue, queueZoneIds, events)
 * @param {object} [deps] test seams
 */
function createPrefetcher(roon, deps = {}) {
  const store = deps.store || nowPlayingStore;
  const lookup = deps.lookup || (track => nowPlayingLyrics.lyricsForNowPlaying(track));
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const generation = new Map(); // zone_id -> number; a new cycle bumps it, the old one stops
  const timers = new Map();

  async function prefetchZone(zoneId) {
    const gen = (generation.get(zoneId) || 0) + 1;
    generation.set(zoneId, gen);
    const stale = () => generation.get(zoneId) !== gen;

    const np = roon.getNowPlaying(zoneId);
    if (!np || np.state !== 'playing' || !np.title) return;
    let queue;
    try {
      queue = await roon.getQueue(zoneId);
    } catch (err) {
      logger.debug({ zone_id: zoneId, err: err.message }, 'Queue prefetch: no queue');
      return;
    }

    let looked = 0;
    for (const track of upcoming(queue, np)) {
      if (stale()) return;
      if (!track.title || !track.artist || statusOf(track) !== 'unknown') continue;
      if (looked++ > 0) await sleep(PAUSE_MS);
      if (stale()) return;
      let lyrics;
      try {
        ({ lyrics } = await lookup(track));
      } catch (err) {
        logger.info({ zone_id: zoneId, err: err.message }, 'Queue prefetch stopped');
        return;
      }
      if (lyrics.error) {
        logger.info({ zone_id: zoneId, err: lyrics.error }, 'Queue prefetch stopped: lyrics server error');
        return;
      }
      if (_seen.size >= SEEN_MAX) _seen.delete(_seen.keys().next().value);
      _seen.set(_key(track), _statusOf(lyrics));
      logger.debug({ zone_id: zoneId, title: track.title, source: lyrics.source }, 'Queue lyrics prefetched');
    }
  }

  // Queue and zone events come in bursts around a track change: wait for them to settle.
  function schedule(zoneId) {
    clearTimeout(timers.get(zoneId));
    timers.set(zoneId, setTimeout(() => {
      timers.delete(zoneId);
      prefetchZone(zoneId).catch(err => logger.warn({ zone_id: zoneId, err: err.message }, 'Queue prefetch failed'));
    }, DEBOUNCE_MS));
  }

  const lastTrack = new Map();
  function onZonesChanged(zoneIds) {
    const active = store.get();
    const watched = new Set(roon.queueZoneIds());
    if (active && active.zone_id) watched.add(active.zone_id);
    for (const zoneId of zoneIds) {
      if (!watched.has(zoneId)) continue;
      const np = roon.getNowPlaying(zoneId);
      if (!np || np.state !== 'playing' || !np.title) continue;
      const key = `${np.title}||${np.artist}||${np.album}`;
      if (lastTrack.get(zoneId) === key) continue;
      lastTrack.set(zoneId, key);
      schedule(zoneId);
    }
  }

  return { prefetchZone, schedule, onZonesChanged };
}

/** Start prefetching on queue and track changes. */
function watchQueue(roon, deps) {
  const prefetcher = createPrefetcher(roon, deps);
  roon.events.on('zones_changed', prefetcher.onZonesChanged);
  roon.events.on('queue_changed', zoneId => prefetcher.schedule(zoneId));
  return prefetcher;
}

/** Test hook. */
function _resetSeen() {
  _seen.clear();
}

module.exports = { watchQueue, createPrefetcher, statusOf, upcoming, LOOKAHEAD, PAUSE_MS, _resetSeen };
