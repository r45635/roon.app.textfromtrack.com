'use strict';

const fs = require('fs');
const { Router } = require('express');
const { E, buildError } = require('../utils/normalize');
const scanner = require('../music/scanner');
const lyricsDetector = require('../music/lyricsDetector');
const musicRoots = require('../music/musicRoots');
const lrclibBatch = require('../library/lrclibBatch');

const router = Router();

const { HAS_LRC_FILE, HAS_EMBEDDED_LYRICS } = lyricsDetector.STATUS;
const hasLyrics = t => t.lyrics_status === HAS_LRC_FILE || t.lyrics_status === HAS_EMBEDDED_LYRICS;

const MAX_LIMIT = 200;

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Library tracks matching a lyrics filter and a free-text query, sorted by artist, album,
 * disc and track number.
 * @param {{ status?: 'missing'|'with'|'all', q?: string }} filter
 */
function selectTracks({ status = 'missing', q = '' } = {}) {
  const words = normalize(q).split(/\s+/).filter(Boolean);
  return scanner.loadIndex().tracks
    .filter(t => (status === 'missing' ? !hasLyrics(t) : status === 'with' ? hasLyrics(t) : true))
    .filter(t => {
      if (!words.length) return true;
      const hay = normalize(`${t.title} ${t.artist} ${t.albumartist} ${t.album} ${t.filename}`);
      return words.every(w => hay.includes(w));
    })
    .sort((a, b) =>
      (a.albumartist || a.artist || '').localeCompare(b.albumartist || b.artist || '')
      || (a.album || '').localeCompare(b.album || '')
      || (a.disc_number || 0) - (b.disc_number || 0)
      || (a.track_number || 0) - (b.track_number || 0)
      || (a.path || '').localeCompare(b.path || ''));
}

/**
 * GET /api/library/summary
 * Lyrics coverage of the scanned library, scan state and reachability of the music roots.
 */
router.get('/summary', (req, res) => {
  const index = scanner.loadIndex();
  const counts = { total: index.tracks.length, lrc_file: 0, embedded: 0, missing: 0 };
  for (const t of index.tracks) {
    if (t.lyrics_status === HAS_LRC_FILE) counts.lrc_file++;
    else if (t.lyrics_status === HAS_EMBEDDED_LYRICS) counts.embedded++;
    else counts.missing++;
  }
  res.json({
    success: true,
    last_scan_at: index.last_scan_at,
    counts,
    roots: musicRoots.getMusicRoots().map(p => ({ path: p, exists: fs.existsSync(p) })),
    scan: scanner.getScanState(),
    batch: lrclibBatch.getState(),
  });
});

/**
 * GET /api/library/tracks?status=missing|with|all&q=&offset=&limit=
 */
router.get('/tracks', (req, res) => {
  const status = ['missing', 'with', 'all'].includes(req.query.status) ? req.query.status : 'missing';
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const all = selectTracks({ status, q: String(req.query.q || '') });
  res.json({
    success: true,
    total: all.length,
    offset,
    tracks: all.slice(offset, offset + limit).map(t => ({
      path: t.path,
      title: t.title,
      artist: t.artist,
      album: t.album,
      track_number: t.track_number,
      duration_seconds: t.duration_seconds,
      lyrics_status: t.lyrics_status,
    })),
  });
});

/**
 * GET /api/library/lrclib-batch — state of the current or last batch.
 */
router.get('/lrclib-batch', (req, res) => {
  res.json({ success: true, batch: lrclibBatch.getState() });
});

/**
 * POST /api/library/lrclib-batch
 * Fetch lyrics from LRCLIB and write them into the files, in the background.
 * Body: { paths?: string[] } or a filter { status?: 'missing'|'with'|'all', q?: string };
 *       synced_only?: boolean (default true — never write lyrics without timestamps).
 */
router.post('/lrclib-batch', (req, res) => {
  const body = req.body || {};
  let paths;
  if (Array.isArray(body.paths)) {
    paths = body.paths.filter(p => typeof p === 'string');
  } else {
    paths = selectTracks({ status: body.status || 'missing', q: String(body.q || '') }).map(t => t.path);
  }
  try {
    const batch = lrclibBatch.start(paths, { syncedOnly: body.synced_only !== false });
    res.status(202).json({ success: true, batch });
  } catch (err) {
    const status = err.code === 'BATCH_RUNNING' ? 409 : err.code === 'NOTHING_TO_DO' ? 400 : 500;
    res.status(status).json(buildError(err.code || E.UNKNOWN_ERROR, err.message));
  }
});

/**
 * POST /api/library/lrclib-batch/cancel — stop after the current track.
 */
router.post('/lrclib-batch/cancel', (req, res) => {
  res.json({ success: true, batch: lrclibBatch.cancel() });
});

module.exports = router;
module.exports.selectTracks = selectTracks;
