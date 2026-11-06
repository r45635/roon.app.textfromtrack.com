'use strict';

const net = require('net');
const EventEmitter = require('events');

const RoonApi = require('node-roon-api');
const RoonApiTransport = require('node-roon-api-transport');
const RoonApiBrowse = require('node-roon-api-browse');
const RoonApiStatus = require('node-roon-api-status');

const config = require('../config');
const logger = require('../utils/logger');
const userSettings = require('../settings/userSettings');
const nowPlayingStore = require('./nowPlayingStore');
const { createSettingsService } = require('./roonSettings');

// ─── Module state ─────────────────────────────────────────────────────────────

let _roon = null;
let _svcStatus = null;
let _settingsPage = null; // { service, refresh } — the companion's page in Roon's settings
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

// Output of the default zone chosen in Roon's settings (null = none). Read at startup and on
// save, not on every refresh: seek ticks refresh the active zone every second.
let _defaultOutputId = null;

function _loadDefaultZone() {
  const z = userSettings.get().default_zone;
  _defaultOutputId = (z && z.output_id) || null;
}

/** zone_id holding the default zone's output (outputs move between zones when grouped). */
function _defaultZoneId() {
  if (!_defaultOutputId) return null;
  for (const zone of _zones.values()) {
    if ((zone.outputs || []).some(o => o.output_id === _defaultOutputId)) return zone.zone_id;
  }
  return null;
}

// Last auto-selected zone_id — kept sticky so transient state changes
// (e.g. 'loading' during a track transition) don't cause zone flapping.
let _autoZoneId = null;

// Roon HTTP server base URL (for image proxy)
let _roonImageBase = null;

// 'zones_changed' (zoneIds: string[]) after a zone's state or track changed (not on seek ticks).
const events = new EventEmitter();

// True while a Core has been reached but the user has not enabled the extension yet.
// node-roon-api has no hook for that state: its registry "register" request simply stays
// unanswered until the user clicks Enable in Roon → Settings → Extensions. So we watch
// that request on the Moo prototype (answered or connection closed = no longer waiting).
let _awaitingAuth = false;

function _watchRegistration() {
  let Moo;
  try { Moo = require('node-roon-api/moo.js'); } catch { return; }
  if (!Moo || !Moo.prototype || Moo.prototype._tftRegistrationWatched) return;
  const original = Moo.prototype.send_request;
  Moo.prototype.send_request = function (name, ...rest) {
    if (name === 'com.roonlabs.registry:1/register') {
      _awaitingAuth = true;
      const i = rest.findIndex(a => typeof a === 'function');
      if (i >= 0) {
        const cb = rest[i];
        rest[i] = function (...args) { _awaitingAuth = false; return cb.apply(this, args); };
      }
    }
    return original.call(this, name, ...rest);
  };
  Moo.prototype._tftRegistrationWatched = true;
}

// ─── Helper: extract now-playing state from a Roon zone object ────────────────

/**
 * Track identity from a Roon now_playing or queue item (both carry the same
 * one_line / two_line / three_line, length and image_key fields).
 */
function trackFromLines(item) {
  const three = item.three_line || {};
  const two = item.two_line || {};
  const one = item.one_line || {};
  return {
    title: three.line1 || two.line1 || one.line1 || null,
    artist: three.line2 || two.line2 || null,
    album: three.line3 || null,
    duration_seconds: item.length || null,
    image_key: item.image_key || null,
  };
}

function _extractNowPlaying(zone) {
  const np = zone.now_playing || null;
  if (!np) return null;

  const settings = zone.settings || {};
  const track = trackFromLines(np);

  return {
    zone_id: zone.zone_id,
    zone_name: zone.display_name,
    state: zone.state || 'stopped',
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration_seconds: track.duration_seconds,
    seek_position_seconds: np.seek_position ?? 0,
    image_key: track.image_key,
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
        ? { type: o.volume.type || 'number', value: o.volume.value, min: o.volume.min, max: o.volume.max,
            step: o.volume.step, is_muted: o.volume.is_muted }
        : null,
    })),
    updated_at: new Date().toISOString(),
  };
}

// ─── Find and update the active zone in the store ────────────────────────────

function _refreshActiveZone() {
  // ── Manual selection takes absolute precedence ────────────────────────────
  if (_activeZoneId) {
    const active = _zones.get(_activeZoneId);
    if (active) {
      // A chosen zone with nothing loaded stays chosen: falling back to another
      // zone here made idle zones impossible to select.
      const state = _extractNowPlaying(active);
      if (state) nowPlayingStore.set(state);
      else nowPlayingStore.clear();
      return;
    }
    // Explicitly selected zone is gone — fall through to auto but don't cling
    // to a stale _activeZoneId (let the UI re-select).
    _activeZoneId = null;
  }

  // ── Default zone from Roon's settings, while it exists ────────────────────
  const defaultZoneId = _defaultZoneId();
  if (defaultZoneId) {
    const state = _extractNowPlaying(_zones.get(defaultZoneId));
    if (state) nowPlayingStore.set(state);
    else nowPlayingStore.clear();
    return;
  }

  // ── Auto-selection with sticky behaviour ──────────────────────────────────
  // If we already have an auto-selected zone, keep it unless:
  //   (a) it was removed from the zones map, OR
  //   (b) a different zone is actively 'playing' (user pressed play elsewhere).
  // Transient states like 'loading' during a track transition are ignored so
  // we don't flip zones and trigger unwanted events.

  if (_autoZoneId && _zones.has(_autoZoneId)) {
    const currentZone = _zones.get(_autoZoneId);
    if (currentZone.state !== 'playing') {
      // Our zone isn't playing right now — only switch if another is explicitly playing.
      for (const zone of _zones.values()) {
        if (zone.zone_id !== _autoZoneId && zone.state === 'playing') {
          logger.debug({ from: _autoZoneId, to: zone.zone_id }, 'Auto-zone switched: another zone started playing');
          _autoZoneId = zone.zone_id;
          break;
        }
      }
    }
    const active = _zones.get(_autoZoneId);
    if (active) {
      const state = _extractNowPlaying(active);
      if (state) { nowPlayingStore.set(state); return; }
    }
    _autoZoneId = null;
  }

  // ── First-time auto-selection ─────────────────────────────────────────────
  _autoZoneId = null;
  let fallback = null;
  for (const zone of _zones.values()) {
    if (zone.state === 'playing') { _autoZoneId = zone.zone_id; break; }
    if (!fallback && zone.now_playing) fallback = zone.zone_id;
  }
  if (!_autoZoneId) _autoZoneId = fallback;

  if (_autoZoneId) {
    const state = _extractNowPlaying(_zones.get(_autoZoneId));
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
  events.emit('zones_changed', zones.map(z => z.zone_id));
}

function _handleZonesChanged(changed) {
  for (const z of changed) _zones.set(z.zone_id, z);
  _refreshActiveZone();
  events.emit('zones_changed', changed.map(z => z.zone_id));
}

function _handleZonesRemoved(removed) {
  for (const id of removed) {
    _zones.delete(id);
    _unsubscribeQueue(id);
  }
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

// ─── Connection diagnostics ───────────────────────────────────────────────────

// node-roon-api drops the socket error ("ERROR undefined"), so a failed Core
// connection is re-probed with a plain TCP connect to learn why.
let _lastConnectError = null; // { host, port, code, at }
let _probeInFlight = false;

function _probeCore(host, port) {
  if (_probeInFlight || !host || !port) return;
  _probeInFlight = true;
  const sock = net.connect({ host, port: Number(port) });
  sock.setTimeout(3000);
  const done = (code) => {
    _probeInFlight = false;
    sock.destroy();
    if (_connected) return;
    _lastConnectError = { host, port: Number(port), code: code || 'WEBSOCKET_FAILED', at: new Date().toISOString() };
    logger.warn(_lastConnectError, 'Roon Core connection probe');
  };
  sock.once('connect', () => done(null));
  sock.once('timeout', () => done('ETIMEDOUT'));
  sock.once('error', (err) => done(err.code));
}

// ─── Direct connect (ROON_CORE_HOST) ──────────────────────────────────────────

const DIRECT_RETRY_MS = 10000;
let _directRetryTimer = null;

/**
 * Connect straight to the Core's extension WebSocket, bypassing Sood discovery.
 * A refused connection only fires onerror (never onclose), and a lost one fires
 * onclose — both schedule a single retry.
 */
function _directConnect() {
  const host = config.roonCoreHost;
  const port = config.roonCorePort;
  logger.info({ host, port }, 'Roon direct connect — connecting to Roon Core');

  const retry = (reason) => {
    if (_directRetryTimer) return;
    _probeCore(host, port);
    logger.warn({ host, port, reason, retry_in_ms: DIRECT_RETRY_MS }, 'Roon direct connect failed — check ROON_CORE_HOST / ROON_CORE_PORT');
    if (_svcStatus) _svcStatus.set_status(`Cannot reach Roon Core at ${host}:${port}`, true);
    _directRetryTimer = setTimeout(() => {
      _directRetryTimer = null;
      _directConnect();
    }, DIRECT_RETRY_MS);
  };

  _roon.ws_connect({
    host,
    port,
    onerror: () => retry('websocket error'),
    onclose: () => retry('connection closed'),
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the Roon API and start local network discovery.
 * Call once at server startup.
 */
function startRoon() {
  _watchRegistration();
  _roon = new RoonApi({
    extension_id: config.roonExtensionId,
    display_name: config.roonDisplayName,
    display_version: config.roonDisplayVersion,
    publisher: config.roonPublisher,
    email: 'support@textfromtrack.com',
    website: 'https://app.textfromtrack.com',

    // Discovery only: node-roon-api clears a discovered Core from _sood_conns on
    // close, which never fires when the first connection fails — every later Sood
    // reply for that Core is then ignored until restart. Drop the stale entry so
    // the 10 s periodic scan retries.
    moo_onerror(moo) {
      const conns = _roon && _roon._sood_conns;
      if (!conns) return;
      for (const [id, conn] of Object.entries(conns)) {
        if (conn === moo) {
          delete conns[id];
          _probeCore(moo.transport && moo.transport.host, moo.transport && moo.transport.port);
          logger.warn({ core_id: id }, 'Roon connection to discovered Core failed — retrying on next scan');
        }
      }
    },

    core_paired(core) {
      logger.info({ core: core.display_name }, 'Roon core paired');
      _transport = core.services.RoonApiTransport;
      _browse = core.services.RoonApiBrowse;
      _connected = true;
      _authorized = true;
      _coreName = core.display_name;
      _coreVersion = core.display_version;
      _lastConnectError = null;

      // Capture Roon HTTP server for image proxy.
      // core.moo.transport.host is the actual IP used to connect to this Core
      // (the Core's real LAN/loopback IP). extension_host is the extension's own
      // IP as seen by the Core — wrong for remote machines.
      const httpPort = core.http_port || 9330;
      const httpHost = core.moo?.transport?.host || '127.0.0.1';
      _roonImageBase = `http://${httpHost}:${httpPort}`;
      logger.info({ _roonImageBase }, 'Roon image base set');

      _svcStatus.set_status(
        `Connected to ${core.display_name}`,
        false
      );

      _transport.subscribe_zones((cmd, data) => {
        if (cmd === 'Subscribed') {
          _handleZones(data.zones || []);
        } else if (cmd === 'Changed') {
          // A new zone (e.g. outputs just grouped) arrives in zones_added, not zones_changed.
          if (data.zones_added) _handleZonesChanged(data.zones_added);
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
      // The connection is gone: its queue subscriptions went with it, nothing to unsubscribe.
      _queues.clear();
      _autoZoneId = null;
      nowPlayingStore.clear();
      if (_svcStatus) _svcStatus.set_status('Disconnected from Roon', true);
    },
  });

  _svcStatus = new RoonApiStatus(_roon);
  _loadDefaultZone();
  _settingsPage = createSettingsService(_roon, {
    onSaved: () => { _loadDefaultZone(); _refreshActiveZone(); },
  });

  _roon.init_services({
    required_services: [RoonApiTransport, RoonApiBrowse],
    provided_services: [_svcStatus, _settingsPage.service],
  });

  _svcStatus.set_status('Waiting for Roon...', false);

  if (config.roonCoreHost) {
    _directConnect();
  } else {
    _roon.start_discovery();
    logger.info('Roon discovery started — authorize the extension in Roon > Settings > Extensions');
  }
}

/**
 * Return the current Roon connection/authorization status.
 * @returns {{ connected: boolean, authorized: boolean, core_name: string|null, core_version: string|null, zone_count: number }}
 */
function getRoonStatus() {
  return {
    connected: _connected,
    authorized: _authorized,
    // Core reached, extension waiting to be enabled in Roon → Settings → Extensions.
    awaiting_authorization: !_connected && _awaitingAuth,
    core_name: _coreName,
    core_version: _coreVersion,
    zone_count: _zones.size,
    last_connect_error: _connected ? null : _lastConnectError,
    // macOS Local Network privacy denies LAN sockets with EHOSTUNREACH ("No route
    // to host") — for a Core that just answered on Sood, that is the tell.
    local_network_blocked: !_connected && process.platform === 'darwin'
      && _lastConnectError?.code === 'EHOSTUNREACH',
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
      volume: o.volume
        ? { type: o.volume.type || 'number', value: o.volume.value, min: o.volume.min, max: o.volume.max, is_muted: o.volume.is_muted }
        : null,
      // Roon gives no device type or icon; standby comes from the output's source control.
      standby: (o.source_controls || []).some(sc => sc.status === 'standby'),
    })),
    is_active: (_activeZoneId || _defaultZoneId())
      ? z.zone_id === (_activeZoneId || _defaultZoneId())
      : z.state === 'playing',
  }));
}

/**
 * Now-playing state of one zone (same shape as nowPlayingStore), or null.
 * Lets each viewer follow its own zone without changing the shared active zone.
 * @param {string} zoneId
 */
function getNowPlaying(zoneId) {
  const zone = _zones.get(zoneId);
  return zone ? _extractNowPlaying(zone) : null;
}

/** Show the web interface's change of a value on the companion's page in Roon's settings. */
function refreshSettingsPage() {
  if (_settingsPage) _settingsPage.refresh();
}

/** Set the zone the user wants to control. Immediately refreshes the now-playing store. */
function setActiveZone(zoneId) {
  if (!_zones.has(zoneId)) throw new Error(`Zone not found: ${zoneId}`);
  _activeZoneId = zoneId;
  _autoZoneId = null; // clear auto-selected zone so manual choice is honoured
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

// ─── Play queue ───────────────────────────────────────────────────────────────

// Queue subscriptions are opened on demand, for at most QUEUE_MAX_SUBS zones: the least
// recently asked one is dropped. zone_id → { handle, items, used, ready, failed }
const QUEUE_MAX_SUBS = 2;
const QUEUE_MAX_ITEMS = 20;
const QUEUE_READY_TIMEOUT_MS = 5000;
const _queues = new Map();
let _queueClock = 0; // order of use (Date.now() ties within a millisecond)
let _queueShapeLogged = false;

/** Apply a Subscribed / Changed message to a queue's items. False for any other message. */
function _applyQueue(items, cmd, data) {
  if (cmd === 'Subscribed') {
    items.splice(0, items.length, ...(data.items || []));
    return true;
  }
  if (cmd !== 'Changed') return false;
  for (const change of data.changes || []) {
    if (change.operation === 'remove') items.splice(change.index, change.count);
    else if (change.operation === 'insert') items.splice(change.index, 0, ...(change.items || []));
  }
  return true;
}

function _unsubscribeQueue(zoneId) {
  const entry = _queues.get(zoneId);
  if (!entry) return;
  _queues.delete(zoneId);
  try {
    if (entry.handle) entry.handle.unsubscribe(() => {});
  } catch (err) {
    logger.debug({ zone_id: zoneId, err: err.message }, 'Roon queue unsubscribe failed');
  }
}

function _subscribeQueue(zoneId) {
  if (_queues.size >= QUEUE_MAX_SUBS) {
    const [oldest] = [..._queues.entries()].sort((a, b) => a[1].used - b[1].used)[0];
    _unsubscribeQueue(oldest);
  }
  const entry = { handle: null, items: [], used: ++_queueClock, failed: null };
  let markReady;
  entry.ready = new Promise(resolve => { markReady = resolve; });
  _queues.set(zoneId, entry);

  entry.handle = _transport.subscribe_queue(_zones.get(zoneId), QUEUE_MAX_ITEMS, (cmd, data) => {
    if (_queues.get(zoneId) !== entry) return; // replaced or dropped meanwhile
    if (!_queueShapeLogged && cmd === 'Subscribed') {
      // Roon doesn't document queue items: record their fields once, never their titles.
      _queueShapeLogged = true;
      const first = (data && data.items && data.items[0]) || {};
      logger.info({ item_count: (data && data.items || []).length, item_fields: Object.keys(first) }, 'Roon queue subscribed');
    }
    if (_applyQueue(entry.items, cmd, data || {})) {
      markReady();
      events.emit('queue_changed', zoneId);
    } else if (cmd !== 'Unsubscribed') {
      logger.warn({ zone_id: zoneId, cmd }, 'Roon queue subscription failed');
      entry.failed = String(cmd);
      _queues.delete(zoneId);
      markReady();
    }
  });
  return entry;
}

/**
 * The play queue of a zone: up to QUEUE_MAX_ITEMS items, the playing track first.
 * Subscribes on first use. Rejects when Roon or the zone is unavailable.
 * @param {string} zoneId
 * @returns {Promise<Array<{queue_item_id, title, artist, album, duration_seconds, image_key}>>}
 */
async function getQueue(zoneId) {
  if (!_transport) throw new Error('Roon transport not available');
  if (!_zones.has(zoneId)) throw new Error(`Zone not found: ${zoneId}`);
  const entry = _queues.get(zoneId) || _subscribeQueue(zoneId);
  entry.used = ++_queueClock;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Roon queue did not answer')), QUEUE_READY_TIMEOUT_MS);
  });
  try {
    await Promise.race([entry.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
  if (entry.failed) throw new Error(`Roon queue subscription failed: ${entry.failed}`);
  return entry.items.map(item => ({ queue_item_id: item.queue_item_id, ...trackFromLines(item) }));
}

/** Zones whose queue is currently subscribed. */
function queueZoneIds() {
  return [..._queues.keys()];
}

/** Start playing a zone from one of its queue items. */
function playFromHere(zoneId, queueItemId) {
  return new Promise((resolve, reject) => {
    if (!_transport) return reject(new Error('Roon transport not available'));
    const zone = _findZone(zoneId);
    if (!zone) return reject(new Error(`Zone not found: ${zoneId}`));
    // Unlike control/seek, play_from_here hands back the raw message, not an error string.
    _transport.play_from_here(zone, queueItemId, (msg) => {
      if (msg && msg.name === 'Success') resolve();
      else reject(new Error(msg ? String(msg.name) : 'NetworkError'));
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
  getAllZones, setActiveZone, getNowPlaying, events,
  controlZone, seekZone,
  changeVolume, muteOutput, muteAll, pauseAll,
  changeSettings,
  transferZone, groupOutputs, ungroupOutputs,
  standbyOutput, convenienceSwitchOutput,
  getQueue, queueZoneIds, playFromHere, trackFromLines,
  refreshSettingsPage,
  browseCatalog, loadBrowse, searchRoon, playOnZone,
};
