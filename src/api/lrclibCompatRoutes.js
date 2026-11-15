'use strict';

// LRCLIB's own endpoint, served by this companion: GET /api/get.
//
// Anything that already speaks LRCLIB — a TFT Panel given this address, another player, a
// script — can point at this host instead of lrclib.net and get the same answers plus what
// only a machine on your network can give: the .lrc files sitting next to your music, the
// words in their tags, the local cache, and a mirror asked before the public service.
//
// It answers from the very chain the player uses (lyricsForNowPlaying → lyricsResolver), so a
// screen gets what this app would show for the same track: the matched local file first, the
// user's own choices (Wrong lyrics, pasted lyrics, a picked version) honoured, damaged copies
// ranked after clean ones. Two fields LRCLIB does not have are added and ignored by its clients:
// `source` (sidecar, embedded, cache, lrclib) and `offsetMs` (the per-track timing offset).
//
// The shape is LRCLIB's, not ours: `track_name`/`artist_name` in, `syncedLyrics`/`plainLyrics`
// out, and 404 when the track is unknown. A server failure is **not** a 404 — it answers 502,
// because a client that takes "it broke" for "no lyrics" caches a lie.

const { Router } = require('express');
const logger = require('../utils/logger');
const { buildError, E } = require('../utils/normalize');
const { lyricsForNowPlaying } = require('../lyrics/nowPlayingLyrics');
const { lrclibGet } = require('../lyrics/lrclibClient');
const screenRequests = require('../lyrics/screenRequests');

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

// Timestamps out, words kept: the plain copy of a synced text, as LRCLIB stores both.
const LRC_TAG = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;
const LRC_META = /^\s*\[[a-z]+:[^\]]*\]\s*$/i;
function plainOf(synced) {
  return synced.split(/\r?\n/)
    .filter(line => !LRC_META.test(line))
    .map(line => line.replace(LRC_TAG, '').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** The resolver's answer in LRCLIB's shape, plus `source` and `offsetMs`. */
function fromResolved(lyrics, query) {
  const text = lyrics.instrumental ? null : lyrics.text;
  return {
    ...asLrclib({ id: lyrics.lrclib_id ?? null, instrumental: lyrics.instrumental }, query),
    plainLyrics: text ? (lyrics.synced ? plainOf(text) || null : text) : null,
    syncedLyrics: text && lyrics.synced ? text : null,
    source: lyrics.source || null,
    offsetMs: lyrics.offset_ms || 0,
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

  const seconds = Number(duration);
  const track = {
    title: String(title),
    artist: String(artist),
    album: album ? String(album) : null,
    duration_seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
  };

  let lyrics;
  try {
    ({ lyrics } = await lyricsForNowPlaying(track));
  } catch (err) {
    logger.warn({ title, artist, err: err.message }, 'GET /api/get: lyrics lookup failed');
    screenRequests.record(track, { error: true });
    return res.status(502).json(buildError(E.LRCLIB_ERROR, err.message));
  }
  screenRequests.record(track, lyrics);

  if (lyrics.error) {
    logger.warn({ title, artist, err: lyrics.error }, 'GET /api/get: lyrics lookup failed');
    return res.status(502).json(buildError(E.LRCLIB_ERROR, lyrics.error));
  }
  // LRCLIB's own body for a miss, so a client written against it reads what it expects.
  // "Wrong lyrics" is a miss too: the user said this track has none worth showing.
  if (!lyrics.found) return res.status(404).json(NOT_FOUND);

  res.json(fromResolved(lyrics, { trackName: track.title, artistName: track.artist,
    albumName: track.album, duration: track.duration_seconds }));
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
