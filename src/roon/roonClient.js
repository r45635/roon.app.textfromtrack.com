'use strict';

const RoonApi = require('node-roon-api');
const RoonApiTransport = require('node-roon-api-transport');
const RoonApiBrowse = require('node-roon-api-browse');
const RoonApiStatus = require('node-roon-api-status');

const config = require('../config');
const logger = require('../utils/logger');
const nowPlayingStore = require('./nowPlayingStore');

// ─── Module state ─────────────────────────────────────────────────────────────

let _roon = null;
let _svcStatus = null;
let _transport = null;
let _browse = null;
let _connected = false;
let _authorized = false;
let _coreName = null;
let _coreVersion = null;

// Full zones map indexed by zone_id (kept in sync with subscription updates)
const _zones = new Map();

// Manually selected active zone_id (null = auto-select playing zone)
let _activeZoneId = null;

// Roon HTTP server base URL (for image proxy)
let _roonImageBase = null;

// ─── Helper: extract now-playing state from a Roon zone object ────────────────

function _extractNowPlaying(zone) {
  const np = zone.now_playing || null;
  if (!np) return null;

  const three = np.three_line || {};
  const two = np.two_line || {};
  const one = np.one_line || {};
  const settings = zone.settings || {};

  return {
    zone_id: zone.zone_id,
    zone_name: zone.display_name,
    state: zone.state || 'stopped',
    title: three.line1 || two.line1 || one.line1 || null,
    artist: three.line2 || two.line2 || null,
    album: three.line3 || null,
    duration_seconds: np.length || null,
    seek_position_seconds: np.seek_position ?? 0,
    image_key: np.image_key || null,
    queue_items_remaining: zone.queue_items_remaining ?? null,
    queue_time_remaining: zone.queue_time_remaining ?? null,
    shuffle: settings.shuffle || false,
    loop: settings.loop || 'disabled',
    auto_radio: settings.auto_radio || false,
    is_play_allowed: zone.is_play_allowed || false,
    is_pause_allowed: zone.is_pause_allowed || false,
    is_next_allowed: zone.is_next_allowed || false,
    is_previous_allowed: zone.is_previous_allowed || false,
    is_seek_allowed: zone.is_seek_allowed || false,
    artist_image_keys: np.artist_image_keys || [],
    outputs: (zone.outputs || []).map(o => ({
      output_id: o.output_id,
      display_name: o.display_name,
      volume: o.volume
        ? { value: o.volume.value, min: o.volume.min, max: o.volume.max,
            step: o.volume.step, is_muted: o.volume.is_muted }
        : null,
    })),
    updated_at: new Date().toISOString(),
  };
}

// ─── Find and update the active zone in the store ────────────────────────────

function _refreshActiveZone() {
  // If user has selected a zone, prefer it; fall back to first playing zone
  let active = null;
  if (_activeZoneId) {
    active = _zones.get(_activeZoneId) || null;
  }
  if (!active) {
    for (const zone of _zones.values()) {
      if (zone.state === 'playing') { active = zone; break; }
      if (!active && zone.now_playing) active = zone;
    }
  }

  if (active) {
    const state = _extractNowPlaying(active);
    if (state) { nowPlayingStore.set(state); return; }
  }
  nowPlayingStore.clear();
}

// ─── Zone subscription handlers ───────────────────────────────────────────────

function _handleZones(zones) {
  _zones.clear();
  for (const z of zones) _zones.set(z.zone_id, z);
  _refreshActiveZone();
  logger.debug({ zoneCount: zones.length }, 'Roon zones subscribed');
}

function _handleZonesChanged(changed) {
  for (const z of changed) _zones.set(z.zone_id, z);
  _refreshActiveZone();
}

function _handleZonesRemoved(removed) {
  for (const id of removed) _zones.delete(id);
  _refreshActiveZone();
}

function _handleZonesSeekChanged(seekChanges) {
  let dirty = false;
  for (const change of seekChanges) {
    const zone = _zones.get(change.zone_id);
    if (zone && zone.now_playing) {
      zone.now_playing.seek_position = change.seek_position;
      dirty = true;
    }
  }
  if (dirty) _refreshActiveZone();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the Roon API and start local network discovery.
 * Call once at server startup.
 */
function startRoon() {
  _roon = new RoonApi({
    extension_id: config.roonExtensionId,
    display_name: config.roonDisplayName,
    display_version: config.roonDisplayVersion,
    publisher: config.roonPublisher,
    email: 'support@textfromtrack.com',
    website: 'https://app.textfromtrack.com',

    core_paired(core) {
      logger.info({ core: core.display_name }, 'Roon core paired');
      _transport = core.services.RoonApiTransport;
      _browse = core.services.RoonApiBrowse;
      _connected = true;
      _authorized = true;
      _coreName = core.display_name;
      _coreVersion = core.display_version;

      // Capture Roon HTTP server for image proxy
      const httpPort = core.http_port || 9330;
      const httpHost = core.extension_host || '127.0.0.1';
      _roonImageBase = `http://${httpHost}:${httpPort}`;
      logger.debug({ _roonImageBase }, 'Roon image base set');

      _svcStatus.set_status(
        `Connected to ${core.display_name}`,
        false
      );

      _transport.subscribe_zones((cmd, data) => {
        if (cmd === 'Subscribed') {
          _handleZones(data.zones || []);
        } else if (cmd === 'Changed') {
          if (data.zones_changed) _handleZonesChanged(data.zones_changed);
          if (data.zones_removed) _handleZonesRemoved(data.zones_removed);
          if (data.zones_seek_changed) _handleZonesSeekChanged(data.zones_seek_changed);
        }
      });
    },

    core_unpaired(core) {
      logger.warn({ core: core.display_name }, 'Roon core unpaired');
      _transport = null;
      _browse = null;
      _connected = false;
      _authorized = false;
      _coreName = null;
      _coreVersion = null;
      _roonImageBase = null;
      _zones.clear();
      nowPlayingStore.clear();
      if (_svcStatus) _svcStatus.set_status('Disconnected from Roon', true);
    },
  });

  _svcStatus = new RoonApiStatus(_roon);

  _roon.init_services({
    required_services: [RoonApiTransport, RoonApiBrowse],
    provided_services: [_svcStatus],
  });

  _svcStatus.set_status('Waiting for Roon...', false);
  _roon.start_discovery();

  logger.info('Roon discovery started — authorize the extension in Roon > Settings > Extensions');
}

/**
 * Return the current Roon connection/authorization status.
 * @returns {{ connected: boolean, authorized: boolean, core_name: string|null, core_version: string|null, zone_count: number }}
 */
function getRoonStatus() {
  return {
    connected: _connected,
    authorized: _authorized,
    core_name: _coreName,
    core_version: _coreVersion,
    zone_count: _zones.size,
  };
}

/**
 * Return the Roon HTTP image base URL (for proxying album art).
 * @returns {string|null}
 */
function getImageBase() {
  return _roonImageBase;
}

/**
 * Send a playback control command to the active zone.
 * @param {string} zoneId
 * @param {'play'|'pause'|'playpause'|'stop'|'next'|'previous'} action
 * @returns {Promise<void>}
 */
function controlZone(zoneId, action) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const zone = _zones.get(zoneId) || zoneId;
    _transport.control(zone, action, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/**
 * Change the volume of a specific output.
 * @param {string} outputId
 * @param {'absolute'|'relative'|'relative_step'} how
 * @param {number} value
 * @returns {Promise<void>}
 */
function changeVolume(outputId, how, value) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    // Find the output object from the zones map
    let output = null;
    for (const zone of _zones.values()) {
      output = (zone.outputs || []).find(o => o.output_id === outputId);
      if (output) break;
    }
    if (!output) return reject(new Error(`Output not found: ${outputId}`));
    _transport.change_volume(output, how, value, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

// ─── Helper: resolve a zone or output object ──────────────────────────────────

function _findZone(zoneId) {
  return _zones.get(zoneId) || null;
}

function _findOutput(outputId) {
  for (const zone of _zones.values()) {
    const out = (zone.outputs || []).find(o => o.output_id === outputId);
    if (out) return out;
  }
  return null;
}

// ─── New transport functions ──────────────────────────────────────────────────

/** Return all known zones as an array (lightweight snapshot for the UI). */
function getAllZones() {
  return Array.from(_zones.values()).map(z => ({
    zone_id: z.zone_id,
    display_name: z.display_name,
    state: z.state || 'stopped',
    now_playing_title: z.now_playing?.three_line?.line1 || z.now_playing?.two_line?.line1 || null,
    now_playing_artist: z.now_playing?.three_line?.line2 || z.now_playing?.two_line?.line2 || null,
    image_key: z.now_playing?.image_key || null,
    outputs: (z.outputs || []).map(o => ({
      output_id: o.output_id,
      display_name: o.display_name,
      volume: o.volume ? { value: o.volume.value, min: o.volume.min, max: o.volume.max, is_muted: o.volume.is_muted } : null,
    })),
    is_active: _activeZoneId ? z.zone_id === _activeZoneId : z.state === 'playing',
  }));
}

/** Set the zone the user wants to control. Immediately refreshes the now-playing store. */
function setActiveZone(zoneId) {
  if (!_zones.has(zoneId)) throw new Error(`Zone not found: ${zoneId}`);
  _activeZoneId = zoneId;
  _refreshActiveZone();
}

/** Seek within the current track. */
function seekZone(zoneId, how, seconds) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const zone = _findZone(zoneId);
    if (!zone) return reject(new Error(`Zone not found: ${zoneId}`));
    _transport.seek(zone, how, seconds, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Mute or unmute a single output. */
function muteOutput(outputId, how) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const output = _findOutput(outputId);
    if (!output) return reject(new Error(`Output not found: ${outputId}`));
    _transport.mute(output, how, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Mute or unmute all zones. */
function muteAll(how) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    _transport.mute_all(how, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Pause all zones. */
function pauseAll() {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    _transport.pause_all((err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Change shuffle/loop/auto_radio settings on a zone. */
function changeSettings(zoneId, settings) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const zone = _findZone(zoneId);
    if (!zone) return reject(new Error(`Zone not found: ${zoneId}`));
    _transport.change_settings(zone, settings, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Transfer the queue from one zone to another. */
function transferZone(fromZoneId, toZoneId) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const from = _findZone(fromZoneId);
    const to = _findZone(toZoneId);
    if (!from) return reject(new Error(`Source zone not found: ${fromZoneId}`));
    if (!to) return reject(new Error(`Destination zone not found: ${toZoneId}`));
    _transport.transfer_zone(from, to, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Group a set of outputs together (first output's zone queue is preserved). */
function groupOutputs(outputIds) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const outputs = outputIds.map(id => {
      const o = _findOutput(id);
      if (!o) throw new Error(`Output not found: ${id}`);
      return o;
    });
    _transport.group_outputs(outputs, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Ungroup a set of outputs. */
function ungroupOutputs(outputIds) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const outputs = outputIds.map(id => {
      const o = _findOutput(id);
      if (!o) throw new Error(`Output not found: ${id}`);
      return o;
    });
    _transport.ungroup_outputs(outputs, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Put an output into standby. */
function standbyOutput(outputId) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const output = _findOutput(outputId);
    if (!output) return reject(new Error(`Output not found: ${outputId}`));
    _transport.standby(output, {}, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

/** Convenience-switch (wake from standby) an output. */
function convenienceSwitchOutput(outputId) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const output = _findOutput(outputId);
    if (!output) return reject(new Error(`Output not found: ${outputId}`));
    _transport.convenience_switch(output, {}, (err) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  });
}

// ─── Browse / Search ──────────────────────────────────────────────────────────

/**
 * Low-level browse call. Wraps RoonApiBrowse.browse() as a Promise.
 * @param {object} opts - browse options (hierarchy, pop_all, multi_session_key, etc.)
 */
function browseCatalog(opts) {
  return new Promise((resolve, reject) => {
    if (!_browse) return reject(new Error('Roon browse not available'));
    _browse.browse(opts, (err, body) => {
      if (err) reject(new Error(String(err)));
      else resolve(body);
    });
  });
}

/**
 * Load items from the current browse level.
 * @param {object} opts - load options (hierarchy, offset, count, etc.)
 */
function loadBrowse(opts) {
  return new Promise((resolve, reject) => {
    if (!_browse) return reject(new Error('Roon browse not available'));
    _browse.load(opts, (err, body) => {
      if (err) reject(new Error(String(err)));
      else resolve(body);
    });
  });
}

/**
 * Convenience: perform a search and return the first page of items.
 * @param {string} query - search text
 * @param {'tracks'|'albums'|'artists'|'composers'|'tags'} [category] - optional filter
 */
async function searchRoon(query, category) {
  // Step 1: open search hierarchy with pop_all to reset session state
  const browseResult = await browseCatalog({
    hierarchy: 'search',
    pop_all: true,
    input: query,
  });

  if (!browseResult || browseResult.action !== 'list') {
    return { items: [], total: 0 };
  }

  // If a category is requested, find that sub-list and drill into it
  if (category) {
    const loadResult = await loadBrowse({ hierarchy: 'search', count: 100 });
    const items = loadResult?.items || [];
    const catItem = items.find(
      i => i.title && i.title.toLowerCase().includes(category.toLowerCase())
    );
    if (catItem && catItem.item_key) {
      const drillResult = await browseCatalog({
        hierarchy: 'search',
        item_key: catItem.item_key,
      });
      if (drillResult?.action === 'list') {
        const drillLoad = await loadBrowse({ hierarchy: 'search', count: 50 });
        return { items: drillLoad?.items || [], total: drillLoad?.list?.count || 0 };
      }
    }
  }

  const loadResult = await loadBrowse({ hierarchy: 'search', count: 100 });
  return { items: loadResult?.items || [], total: loadResult?.list?.count || 0 };
}

/**
 * Trigger "Play Now" (or first available play action) on a Roon item from
 * the current browse session, sending the playback to a specific zone.
 *
 * Supports items whose hint is `action_list` (typical for tracks: Roon returns
 * a list of actions like Play Now / Queue / Add Next when drilled) or `action`
 * (the item is itself the action). Items with hint `list` (artists, albums)
 * are not directly playable here — the caller should drill further first.
 *
 * The browse hierarchy is taken from the session that was last opened by
 * searchRoon() / browseCatalog() — typically "search". The item_key passed in
 * must come from that same session.
 *
 * @param {string} itemKey      The item_key returned by the search/browse call.
 * @param {string} hierarchy    The browse hierarchy that owns the item_key (e.g. 'search').
 * @param {string} zoneOrOutputId  Roon zone or output id where playback should start.
 * @returns {Promise<{ played: boolean, action_used?: string, message?: string }>}
 */
async function playOnZone(itemKey, hierarchy, zoneOrOutputId) {
  if (!_browse) throw new Error('Roon browse not available');
  if (!itemKey) throw new Error('item_key is required');
  if (!hierarchy) throw new Error('hierarchy is required');
  if (!zoneOrOutputId) throw new Error('zone_or_output_id is required');

  // Drill into the item, sending the target zone in the same call so Roon
  // already knows where playback should be routed when we trigger an action.
  const drilled = await browseCatalog({
    hierarchy,
    item_key: itemKey,
    zone_or_output_id: zoneOrOutputId,
  });

  // Case 1: Roon already executed something (e.g. an `action` item) — done.
  if (!drilled || drilled.action === 'message' || drilled.action === 'none') {
    return { played: true, message: drilled && drilled.message };
  }

  // Case 2: Roon returned a list — usually the action list for a track.
  if (drilled.action !== 'list') {
    throw new Error(`Unexpected browse action: ${drilled.action}`);
  }

  const loaded = await loadBrowse({ hierarchy, count: 100 });
  const items = (loaded && loaded.items) || [];

  // Pick the best Play action available, in order of preference.
  const preferences = [/^play\s*now$/i, /^play$/i, /^play\s*from\s*here$/i, /^play\s*album$/i];

  function findPlayAction(candidates) {
    for (const re of preferences) {
      const found = candidates.find(i => i.hint === 'action' && typeof i.title === 'string' && re.test(i.title.trim()));
      if (found) return found;
    }
    // Fallback: first action-hint item whose title contains "play"
    return candidates.find(i => i.hint === 'action' && /play/i.test(i.title || '')) || null;
  }

  let actionItem = findPlayAction(items);

  // Second-level drill: Roon sometimes returns the track itself (hint:
  // action_list) rather than its actions, requiring one more navigation step.
  if (!actionItem) {
    const actionListItem = items.find(i => i.hint === 'action_list');
    if (actionListItem) {
      const drilled2 = await browseCatalog({
        hierarchy,
        item_key: actionListItem.item_key,
        zone_or_output_id: zoneOrOutputId,
      });
      if (drilled2 && drilled2.action === 'list') {
        const loaded2 = await loadBrowse({ hierarchy, count: 100 });
        const items2 = (loaded2 && loaded2.items) || [];
        actionItem = findPlayAction(items2);
      }
    }
  }

  if (!actionItem) {
    const titles = items.map(i => i.title).filter(Boolean).join(', ');
    throw new Error(`No Play action available for this item. Available: ${titles || '(none)'}`);
  }

  const triggered = await browseCatalog({
    hierarchy,
    item_key: actionItem.item_key,
    zone_or_output_id: zoneOrOutputId,
  });

  return {
    played: true,
    action_used: actionItem.title,
    message: triggered && triggered.message,
  };
}

module.exports = {
  startRoon, getRoonStatus, getImageBase,
  getAllZones, setActiveZone,
  controlZone, seekZone,
  changeVolume, muteOutput, muteAll, pauseAll,
  changeSettings,
  transferZone, groupOutputs, ungroupOutputs,
  standbyOutput, convenienceSwitchOutput,
  browseCatalog, loadBrowse, searchRoon, playOnZone,
};
