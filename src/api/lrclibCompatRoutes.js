'use strict';

// LRCLIB's own endpoint, served by this companion: GET /api/get.
//
// Anything that already speaks LRCLIB — a TFT Panel given this address, another player, a
// script — can point at this host instead of lrclib.net and get the same answers plus what
// only a machine on your network can give: the .lrc files sitting next to your music, the
// local cache, and a mirror asked before the public service.
//
// The shape is LRCLIB's, not ours: `track_name`/`artist_name` in, `syncedLyrics`/`plainLyrics`
// out, and 404 when the track is unknown. A server failure is **not** a 404 — it answers 502,
// because a client that takes "it broke" for "no lyrics" caches a lie.

const { Router } = require('express');
const logger = require('../utils/logger');
const { buildError, E } = require('../utils/normalize');
const { lookupLyrics } = require('../lyrics/lyricsLookup');
const { lrclibGet } = require('../lyrics/lrclibClient');

const router = Router();

// LRCLIB's shape for one record: null for what we cannot know, never an absent field.
function asLrclib(d, fallback = {}) {
  return {
    id: d.id ?? fallback.id ?? null,
    name: d.trackName || fallback.trackName || null,
    trackName: d.trackName || fallback.trackName || null,
    artistName: d.artistName || fallback.artistName || null,
    albumName: d.albumName || fallback.albumName || null,
    duration: Number(fallback.duration) > 0 ? Number(fallback.duration) : (d.duration ?? null),
    instrumental: !!d.instrumental,
    plainLyrics: d.plainLyrics || d.plain || null,
    syncedLyrics: d.syncedLyrics || d.synced || null,
  };
}

const NOT_FOUND = { code: 404, name: 'TrackNotFound', message: 'Failed to find specified track' };

router.get('/get', async (req, res) => {
  const { track_name: title, artist_name: artist, album_name: album, duration } = req.query;
  if (!title || !artist) {
    return res.status(400).json(buildError(
      E.INVALID_REQUEST, 'track_name and artist_name are required'
    ));
  }

  const found = await lookupLyrics({ title, artist, album, duration });

  if (found.error) {
    logger.warn({ title, artist, err: found.error.message }, 'GET /api/get: lyrics lookup failed');
    return res.status(502).json(found);
  }
  // LRCLIB's own body for a miss, so a client written against it reads what it expects.
  if (!found.found) return res.status(404).json(NOT_FOUND);

  res.json(asLrclib(found, { trackName: title, artistName: artist, albumName: album, duration }));
});

// GET /api/get/:id — the same record by its LRCLIB id. A client that checks whether a server
// "answers like LRCLIB" probes this one (our own lrclibClient does), so without it the companion
// is refused as a lyrics source by anything written against LRCLIB, this app included.
router.get('/get/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'id must be a numeric LRCLIB track id'));
  }
  try {
    const result = await lrclibGet(`/api/get/${id}`);
    if (!result || !result.body) return res.status(404).json(NOT_FOUND);
    res.json(asLrclib(result.body));
  } catch (err) {
    logger.warn({ id, err: err.message }, 'GET /api/get/:id failed');
    res.status(502).json(buildError(E.LRCLIB_ERROR, err.message));
  }
});

module.exports = router;
