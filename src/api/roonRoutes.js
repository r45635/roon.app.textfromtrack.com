'use strict';

const { Router } = require('express');
const {
  getRoonStatus, getImageBase,
  getAllZones, setActiveZone,
  controlZone, seekZone,
  changeVolume, muteOutput, muteAll, pauseAll,
  changeSettings,
  transferZone, groupOutputs, ungroupOutputs,
  standbyOutput, convenienceSwitchOutput,
  browseCatalog, loadBrowse, searchRoon, playOnZone,
} = require('../roon/roonClient');
const nowPlayingStore = require('../roon/nowPlayingStore');
const { E, buildError } = require('../utils/normalize');

const router = Router();

/**
 * GET /api/roon/status
 * Returns whether the Roon Core is discovered and the extension is authorized.
 */
router.get('/status', (req, res) => {
  const status = getRoonStatus();
  res.json({ success: true, ...status });
});

/**
 * GET /api/roon/now-playing
 * Returns the latest now-playing state from the active zone.
 */
router.get('/now-playing', (req, res) => {
  const state = nowPlayingStore.get();
  if (!state) {
    const roon = getRoonStatus();
    if (!roon.connected) {
      return res.status(503).json(buildError(E.ROON_NOT_CONNECTED, 'Roon Core is not connected'));
    }
    if (!roon.authorized) {
      return res.status(403).json(buildError(E.ROON_NOT_AUTHORIZED, 'Extension is not authorized in Roon'));
    }
    return res.status(404).json(buildError(E.NO_CURRENT_TRACK, 'No track is currently playing'));
  }
  res.json({ success: true, now_playing: state });
});

/**
 * GET /api/roon/image/:key
 * Proxy album art from the Roon HTTP server.
 * Query params: w (width, default 300), h (height, default 300)
 */
router.get('/image/:key', async (req, res) => {
  const { key } = req.params;
  if (!key || !/^[a-f0-9]+$/i.test(key)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'Invalid image key'));
  }

  const imageBase = getImageBase();
  if (!imageBase) {
    return res.status(503).json(buildError(E.ROON_NOT_CONNECTED, 'Roon not connected'));
  }

  const w = Math.min(Math.max(parseInt(req.query.w) || 300, 50), 800);
  const h = Math.min(Math.max(parseInt(req.query.h) || 300, 50), 800);

  try {
    const upstream = await fetch(
      `${imageBase}/api/image/${key}?scale=fit&width=${w}&height=${h}`
    );
    if (!upstream.ok) return res.status(upstream.status).end();

    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(502).json(buildError(E.UNKNOWN_ERROR, 'Failed to fetch image from Roon'));
  }
});

/**
 * POST /api/roon/control
 * Send a playback control command to the active zone.
 * Body: { action: 'play' | 'pause' | 'playpause' | 'stop' | 'next' | 'previous' }
 */
router.post('/control', async (req, res) => {
  const VALID_ACTIONS = ['play', 'pause', 'playpause', 'stop', 'next', 'previous'];
  const { action } = req.body || {};

  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`));
  }

  const state = nowPlayingStore.get();
  if (!state) {
    return res.status(404).json(buildError(E.NO_CURRENT_TRACK, 'No active zone'));
  }

  try {
    await controlZone(state.zone_id, action);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/volume
 * Change the volume of an output.
 * Body: { output_id, how: 'absolute'|'relative'|'relative_step', value: number }
 */
router.post('/volume', async (req, res) => {
  const { output_id, how, value } = req.body || {};
  const VALID_HOW = ['absolute', 'relative', 'relative_step'];

  if (!output_id || typeof output_id !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'output_id is required'));
  }
  if (!VALID_HOW.includes(how)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, `how must be one of: ${VALID_HOW.join(', ')}`));
  }
  if (typeof value !== 'number') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'value must be a number'));
  }

  try {
    await changeVolume(output_id, how, value);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * GET /api/roon/zones
 * Return all known Roon zones with their current state.
 */
router.get('/zones', (req, res) => {
  const roon = getRoonStatus();
  if (!roon.connected) {
    return res.status(503).json(buildError(E.ROON_NOT_CONNECTED, 'Roon Core is not connected'));
  }
  res.json({ success: true, zones: getAllZones() });
});

/**
 * POST /api/roon/active-zone
 * Switch the zone being controlled.
 * Body: { zone_id }
 */
router.post('/active-zone', (req, res) => {
  const { zone_id } = req.body || {};
  if (!zone_id || typeof zone_id !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'zone_id is required'));
  }
  try {
    setActiveZone(zone_id);
    res.json({ success: true });
  } catch (err) {
    res.status(404).json(buildError(E.INVALID_REQUEST, err.message));
  }
});

/**
 * POST /api/roon/seek
 * Seek within the currently playing track.
 * Body: { zone_id?, how: 'relative'|'absolute', seconds: number }
 */
router.post('/seek', async (req, res) => {
  const VALID_HOW = ['relative', 'absolute'];
  const state = nowPlayingStore.get();
  const zone_id = req.body?.zone_id || state?.zone_id;
  const { how, seconds } = req.body || {};

  if (!zone_id) return res.status(404).json(buildError(E.NO_CURRENT_TRACK, 'No active zone'));
  if (!VALID_HOW.includes(how)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, `how must be one of: ${VALID_HOW.join(', ')}`));
  }
  if (typeof seconds !== 'number') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'seconds must be a number'));
  }

  try {
    await seekZone(zone_id, how, seconds);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/mute
 * Mute or unmute a specific output.
 * Body: { output_id, how: 'mute'|'unmute' }
 */
router.post('/mute', async (req, res) => {
  const VALID_HOW = ['mute', 'unmute'];
  const { output_id, how } = req.body || {};

  if (!output_id || typeof output_id !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'output_id is required'));
  }
  if (!VALID_HOW.includes(how)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, `how must be one of: ${VALID_HOW.join(', ')}`));
  }

  try {
    await muteOutput(output_id, how);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/pause-all
 * Pause all zones.
 */
router.post('/pause-all', async (req, res) => {
  try {
    await pauseAll();
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/mute-all
 * Mute or unmute all zones.
 * Body: { how: 'mute'|'unmute' }
 */
router.post('/mute-all', async (req, res) => {
  const VALID_HOW = ['mute', 'unmute'];
  const { how } = req.body || {};

  if (!VALID_HOW.includes(how)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, `how must be one of: ${VALID_HOW.join(', ')}`));
  }

  try {
    await muteAll(how);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/settings
 * Change zone settings (shuffle, loop, auto_radio).
 * Body: { zone_id?, shuffle?: boolean, loop?: 'disabled'|'loop'|'loop_one', auto_radio?: boolean }
 */
router.post('/settings', async (req, res) => {
  const state = nowPlayingStore.get();
  const zone_id = req.body?.zone_id || state?.zone_id;
  const { shuffle, loop, auto_radio } = req.body || {};

  if (!zone_id) return res.status(404).json(buildError(E.NO_CURRENT_TRACK, 'No active zone'));

  const VALID_LOOP = ['disabled', 'loop', 'loop_one'];
  if (loop !== undefined && !VALID_LOOP.includes(loop)) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, `loop must be one of: ${VALID_LOOP.join(', ')}`));
  }

  const settings = {};
  if (shuffle !== undefined) settings.shuffle = Boolean(shuffle);
  if (loop !== undefined) settings.loop = loop;
  if (auto_radio !== undefined) settings.auto_radio = Boolean(auto_radio);

  if (Object.keys(settings).length === 0) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'At least one of shuffle, loop, auto_radio is required'));
  }

  try {
    await changeSettings(zone_id, settings);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/transfer
 * Transfer the queue from one zone to another.
 * Body: { from_zone_id?, to_zone_id }
 */
router.post('/transfer', async (req, res) => {
  const state = nowPlayingStore.get();
  const { to_zone_id } = req.body || {};
  const from_zone_id = req.body?.from_zone_id || state?.zone_id;

  if (!from_zone_id) return res.status(404).json(buildError(E.NO_CURRENT_TRACK, 'No source zone'));
  if (!to_zone_id || typeof to_zone_id !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'to_zone_id is required'));
  }

  try {
    await transferZone(from_zone_id, to_zone_id);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/group
 * Group multiple outputs together.
 * Body: { output_ids: string[] }
 */
router.post('/group', async (req, res) => {
  const { output_ids } = req.body || {};
  if (!Array.isArray(output_ids) || output_ids.length < 2) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'output_ids must be an array of at least 2 output IDs'));
  }

  try {
    await groupOutputs(output_ids);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/ungroup
 * Ungroup outputs.
 * Body: { output_ids: string[] }
 */
router.post('/ungroup', async (req, res) => {
  const { output_ids } = req.body || {};
  if (!Array.isArray(output_ids) || output_ids.length === 0) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'output_ids must be a non-empty array'));
  }

  try {
    await ungroupOutputs(output_ids);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/standby
 * Put an output into standby.
 * Body: { output_id }
 */
router.post('/standby', async (req, res) => {
  const { output_id } = req.body || {};
  if (!output_id || typeof output_id !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'output_id is required'));
  }

  try {
    await standbyOutput(output_id);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/convenience-switch
 * Wake an output from standby.
 * Body: { output_id }
 */
router.post('/convenience-switch', async (req, res) => {
  const { output_id } = req.body || {};
  if (!output_id || typeof output_id !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'output_id is required'));
  }

  try {
    await convenienceSwitchOutput(output_id);
    res.json({ success: true });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * GET /api/roon/search?q=...&category=tracks|albums|artists
 * Search the Roon catalog.
 */
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = req.query.category || null;

  if (!q) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'q (search query) is required'));
  }

  const roon = getRoonStatus();
  if (!roon.connected) {
    return res.status(503).json(buildError(E.ROON_NOT_CONNECTED, 'Roon Core is not connected'));
  }

  try {
    const result = await searchRoon(q, category);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/browse
 * Low-level browse call for custom hierarchical navigation.
 * Body: browse opts as per RoonApiBrowse.browse()
 */
router.post('/browse', async (req, res) => {
  const opts = req.body || {};
  if (!opts.hierarchy) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'hierarchy is required'));
  }

  try {
    const result = await browseCatalog(opts);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/browse/load
 * Load items from the current browse level.
 * Body: load opts as per RoonApiBrowse.load()
 */
router.post('/browse/load', async (req, res) => {
  const opts = req.body || {};
  if (!opts.hierarchy) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'hierarchy is required'));
  }

  try {
    const result = await loadBrowse(opts);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

/**
 * POST /api/roon/play-item
 * Trigger Play Now on a previously-browsed item, routed to a target zone.
 * Body: {
 *   item_key: string,           // from a fresh search/browse result
 *   hierarchy?: string,         // defaults to 'search'
 *   zone_or_output_id: string,  // target zone or output
 * }
 */
router.post('/play-item', async (req, res) => {
  const { item_key, hierarchy = 'search', zone_or_output_id } = req.body || {};
  if (!item_key || typeof item_key !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'item_key is required'));
  }
  if (!zone_or_output_id || typeof zone_or_output_id !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'zone_or_output_id is required'));
  }
  try {
    const result = await playOnZone(item_key, hierarchy, zone_or_output_id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(503).json(buildError(E.ROON_NOT_CONNECTED, err.message));
  }
});

module.exports = router;
