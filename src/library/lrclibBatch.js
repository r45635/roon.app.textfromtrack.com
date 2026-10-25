'use strict';

/**
 * Background batch: fetch lyrics from LRCLIB for many library tracks and write them into
 * the files (Files Management defaults). One batch at a time, state kept in memory.
 *
 * Polite to LRCLIB: one track at a time, a pause between network lookups, and a growing
 * wait when it answers busy (503/429) or the network fails — a busy LRCLIB can last minutes.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { AppError } = require('../utils/normalize');
const scanner = require('../music/scanner');
const lyricsDetector = require('../music/lyricsDetector');
const lyricsWriter = require('../music/lyricsWriter');
const musicRoots = require('../music/musicRoots');
const lrcCache = require('../utils/lrcCache');
const lyricsResolver = require('../lyrics/lyricsResolver');

const timing = {
  pauseMs: 1000,                      // between two LRCLIB lookups
  retryWaitsMs: [30000, 60000, 120000], // waits before retrying a busy/unreachable LRCLIB
};
const FLUSH_EVERY = 25;     // index writes are batched
const MAX_ERRORS_KEPT = 20;
const RETRYABLE_RE = /HTTP (429|5\d\d)|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i;

function _idle() {
  return {
    running: false, cancelled: false, synced_only: true,
    total: 0, done: 0, saved: 0, not_found: 0, plain_skipped: 0, already_had: 0, skipped: 0, failed: 0,
    current: null, waiting_until: null, wait_reason: null,
    started_at: null, finished_at: null, errors: [],
  };
}

let _state = _idle();
let _cancel = false;

function getState() {
  return { ..._state, errors: [..._state.errors] };
}

function _sleep(ms) {
  return new Promise(resolve => {
    const end = Date.now() + ms;
    const tick = () => (_cancel || Date.now() >= end ? resolve() : setTimeout(tick, Math.min(250, ms)));
    tick();
  });
}

async function _lookupWithRetry(track) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await lyricsResolver.lookupLrclib(track);
    } catch (err) {
      if (attempt >= timing.retryWaitsMs.length || !RETRYABLE_RE.test(err.message)) throw err;
      const wait = timing.retryWaitsMs[attempt];
      _state.waiting_until = new Date(Date.now() + wait).toISOString();
      _state.wait_reason = err.message;
      logger.warn({ err: err.message, wait_ms: wait }, 'LRCLIB batch: waiting before retry');
      await _sleep(wait);
      _state.waiting_until = null;
      _state.wait_reason = null;
      if (_cancel) throw new AppError('CANCELLED', 'Batch cancelled');
    }
  }
}

/**
 * @returns {Promise<{ kind: string, status?: string, network?: boolean }>}
 *   kind = the counter to increment; status = new lyrics_status for the index
 */
async function _processTrack(t, syncedOnly) {
  if (!t.title || !t.artist) return { kind: 'skipped' };
  const audioPath = path.resolve(t.path);
  if (!musicRoots.isUnderMusicRoot(audioPath) || !fs.existsSync(audioPath)) return { kind: 'skipped' };

  // The index may be stale: never overwrite lyrics that are already in or next to the file.
  const local = await lyricsDetector.readLocalLyrics(audioPath).catch(() => null);
  if (local) {
    const status = local.source === 'lrc'
      ? lyricsDetector.STATUS.HAS_LRC_FILE
      : lyricsDetector.STATUS.HAS_EMBEDDED_LYRICS;
    return { kind: 'already_had', status };
  }

  let text = lrcCache.getByMeta(t.artist, t.title, t.album);
  let network = false;
  if (!text) {
    network = true;
    const found = await _lookupWithRetry({
      title: t.title, artist: t.artist, album: t.album, duration_seconds: t.duration_seconds,
    });
    if (!found.found || !found.text) return { kind: 'not_found', network };
    text = found.text;
    lrcCache.setByMeta(t.artist, t.title, t.album, text);
  }
  if (syncedOnly && !lyricsResolver.isSynced(text)) return { kind: 'plain_skipped', network };

  const written = lyricsWriter.writeLyricsToFile(audioPath, text);
  lrcCache.set(audioPath, text);
  return { kind: 'saved', status: written.status, network };
}

async function _run(tracks, syncedOnly) {
  const pending = [];
  const flush = () => {
    try {
      scanner.updateTracksLyricsStatus(pending.splice(0));
    } catch (err) {
      logger.warn({ err: err.message }, 'LRCLIB batch: index update failed');
    }
  };

  for (const t of tracks) {
    if (_cancel) break;
    _state.current = { title: t.title, artist: t.artist, album: t.album, path: t.path };
    let outcome = null;
    try {
      outcome = await _processTrack(t, syncedOnly);
      _state[outcome.kind]++;
      if (outcome.status) pending.push({ path: t.path, status: outcome.status });
    } catch (err) {
      if (_cancel) break;
      _state.failed++;
      _state.errors.push({ path: t.path, title: t.title, artist: t.artist, error: err.message });
      if (_state.errors.length > MAX_ERRORS_KEPT) _state.errors.shift();
      logger.warn({ err: err.message, path: t.path }, 'LRCLIB batch: track failed');
    }
    _state.done++;
    if (pending.length >= FLUSH_EVERY) flush();
    if (outcome?.network) await _sleep(timing.pauseMs);
  }
  flush();
}

/**
 * Start a batch over library tracks (given by path; unknown paths are ignored).
 * @param {string[]} paths
 * @param {{ syncedOnly?: boolean }} [opts] syncedOnly: don't write lyrics without timestamps
 */
function start(paths, { syncedOnly = true } = {}) {
  if (_state.running) throw new AppError('BATCH_RUNNING', 'A lyrics batch is already running');
  const byPath = new Map(scanner.loadIndex().tracks.map(t => [t.path, t]));
  const tracks = [...new Set(paths)].map(p => byPath.get(p)).filter(Boolean);
  if (!tracks.length) throw new AppError('NOTHING_TO_DO', 'No library track to process');

  _cancel = false;
  _state = { ..._idle(), running: true, synced_only: syncedOnly, total: tracks.length, started_at: new Date().toISOString() };
  logger.info({ total: tracks.length, syncedOnly }, 'LRCLIB batch started');

  _run(tracks, syncedOnly)
    .catch(err => {
      logger.error({ err: err.message }, 'LRCLIB batch crashed');
      _state.errors.push({ path: null, error: err.message });
    })
    .finally(() => {
      _state.running = false;
      _state.cancelled = _cancel;
      _state.current = null;
      _state.waiting_until = null;
      _state.wait_reason = null;
      _state.finished_at = new Date().toISOString();
      logger.info(getState(), 'LRCLIB batch finished');
    });
  return getState();
}

/** Ask the running batch to stop after the current track. */
function cancel() {
  if (_state.running) _cancel = true;
  return getState();
}

module.exports = { start, cancel, getState, timing };
