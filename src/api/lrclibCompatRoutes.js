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

const router = Router();

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
  if (!found.found) {
    // LRCLIB's own body for a miss, so a client written against it reads what it expects.
    return res.status(404).json({
      code: 404, name: 'TrackNotFound', message: 'Failed to find specified track',
    });
  }

  res.json({
    id: null,
    name: found.trackName || title,
    trackName: found.trackName || title,
    artistName: found.artistName || artist,
    albumName: found.albumName || album || null,
    duration: Number(duration) > 0 ? Number(duration) : null,
    instrumental: !!found.instrumental,
    plainLyrics: found.plain || null,
    syncedLyrics: found.synced || null,
  });
});

module.exports = router;
