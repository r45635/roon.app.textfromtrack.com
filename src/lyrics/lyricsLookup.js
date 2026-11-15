'use strict';

const logger = require('../utils/logger');
const { buildError } = require('../utils/normalize');
const lrcCache = require('../utils/lrcCache');
const { lrclibGet } = require('./lrclibClient');
const lyricsResolver = require('./lyricsResolver');

/**
 * Resolve lyrics for one track: the local .lrc cache first, then the LRCLIB servers
 * (a mirror before lrclib.net when one is configured), then a search fallback.
 * Shared by GET /api/lrclib/lookup and by the LRCLIB-compatible GET /api/get, so both
 * answer from the same cache and the same ranking.
 * @returns {Promise<object>} the /lookup answer: { found, synced, plain, instrumental, ... },
 *   or { found: false, error } when a server failed - a failure is not a miss.
 */
async function lookupLyrics({ title, artist, album, duration, path: audioPath }) {
  // Check local cache before hitting lrclib.net
  const cachedLrc = (audioPath && lrcCache.get(audioPath)) || lrcCache.getByMeta(artist, title, album);
  if (cachedLrc) {
    logger.info({ title, artist }, 'LRCLIB lookup: cache hit, skipping lrclib.net');
    const hasSyncedLines = /^\[\d{2}:\d{2}\.\d{2}\]/m.test(cachedLrc);
    return {
      found: true,
      fromCache: true,
      synced: hasSyncedLines ? cachedLrc : null,
      plain: hasSyncedLines ? null : cachedLrc,
      instrumental: false,
      trackName: title,
      artistName: artist,
      albumName: album || null,
      source: 'local_cache',
    };
  }

  try {
    // Build query string for /api/get
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) params.set('album_name', album);
    if (duration) params.set('duration', String(Math.round(Number(duration))));

    logger.info({ title, artist, album, duration }, 'LRCLIB lookup /api/get');
    const result = await lrclibGet(`/api/get?${params.toString()}`);

    // Not found, error response, or missing body → try search fallback
    if (!result || result.status < 200 || result.status >= 300 || !result.body) {
      logger.info({ title, artist }, 'LRCLIB /api/get not found, trying /api/search');
      const searchParams = new URLSearchParams({ track_name: title, artist_name: artist });
      const searchResult = await lrclibGet(`/api/search?${searchParams.toString()}`);

      if (!searchResult || !searchResult.body || !Array.isArray(searchResult.body) || searchResult.body.length === 0) {
        return { found: false };
      }

      // Same choice as the player (lyricsResolver.rankHits): the right length first, then the
      // same kind of recording, then synced. The list is returned best fit first.
      const track = { title, album, duration_seconds: Number(duration) > 0 ? Number(duration) : null };
      const hits = lyricsResolver.rankHits(searchResult.body, track, { keepEmpty: true });
      const best = lyricsResolver.pickHit(hits, track) || hits[0];
      const bestIdx = hits.indexOf(best);

      // Expose hit metadata (no lyrics) so the client can render a version picker without
      // bloating the response. Lyrics are fetched on-demand via GET /hit/:id when the user
      // switches to a different version.
      const allHits = hits.map(h => ({
        id: h.id,
        instrumental: !!h.instrumental,
        hasSynced: !!h.syncedLyrics,
        trackName: h.trackName || null,
        artistName: h.artistName || null,
        albumName: h.albumName || null,
        duration: Number.isFinite(h.duration) ? h.duration : null,
      }));

      return {
        found: true,
        synced: best.syncedLyrics || null,
        plain: best.plainLyrics || null,
        instrumental: !!best.instrumental,
        trackName: best.trackName,
        artistName: best.artistName,
        albumName: best.albumName,
        source: 'search',
        hits: allHits.length > 1 ? allHits : undefined,
        selectedHitIndex: allHits.length > 1 ? bestIdx : undefined,
      };
    }

    const data = result.body;
    if (data.instrumental) {
      return { found: true, instrumental: true, synced: null, plain: null, source: 'get' };
    }

    if (!data.syncedLyrics && !data.plainLyrics) {
      return { found: false };
    }

    return {
      found: true,
      synced: data.syncedLyrics || null,
      plain: data.plainLyrics || null,
      instrumental: false,
      trackName: data.trackName,
      artistName: data.artistName,
      albumName: data.albumName,
      source: 'get',
    };
  } catch (err) {
    logger.error({ err: err.message }, 'LRCLIB lookup failed');
    // Return 200 so the browser does not log a 5xx console error.
    return { ...buildError('LRCLIB_ERROR', err.message), found: false };
  }
}

module.exports = { lookupLyrics };
