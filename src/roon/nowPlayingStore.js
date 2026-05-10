'use strict';

/**
 * In-memory store for the current Roon now-playing state.
 * Shared across the Roon client and API routes.
 */

let _state = null;

/**
 * @typedef {Object} NowPlayingState
 * @property {string}      zone_id
 * @property {string}      zone_name
 * @property {string}      state               - "playing" | "paused" | "stopped" | "loading"
 * @property {string|null} title
 * @property {string|null} artist
 * @property {string|null} album
 * @property {number|null} duration_seconds
 * @property {number}      seek_position_seconds
 * @property {string|null} image_key           - Roon image key for album art
 * @property {number|null} queue_items_remaining
 * @property {number|null} queue_time_remaining
 * @property {boolean}     shuffle
 * @property {string}      loop                - "disabled" | "loop" | "loop_one"
 * @property {boolean}     auto_radio
 * @property {boolean}     is_play_allowed
 * @property {boolean}     is_pause_allowed
 * @property {boolean}     is_next_allowed
 * @property {boolean}     is_previous_allowed
 * @property {boolean}     is_seek_allowed
 * @property {string[]}    artist_image_keys   - Roon image keys for artist images
 * @property {Array<{output_id:string, display_name:string, volume:{value:number,min:number,max:number,step:number,is_muted:boolean}|null}>} outputs
 * @property {string}      updated_at          - ISO-8601 timestamp
 */

/**
 * Update the store with a new now-playing state.
 * @param {NowPlayingState} state
 */
function set(state) {
  _state = state;
}

/**
 * Get the current now-playing state, or null if nothing is playing.
 * @returns {NowPlayingState|null}
 */
function get() {
  return _state;
}

/**
 * Clear the store (e.g. when Roon core unpairs).
 */
function clear() {
  _state = null;
}

module.exports = { set, get, clear };
