'use strict';

/**
 * When the backend child dies on its own, the desktop app brings it back a few times before
 * bothering the person: a lyrics server that stays dead until someone notices the tray icon is
 * not a server, and the screens that ask it for words go silent meanwhile.
 *
 * Bounded: at most `delaysMs.length` restarts inside `windowMs`, each one waiting longer than
 * the last. Past that, the crash dialog of old. No Electron here, so it is tested on its own.
 */
const DEFAULTS = { windowMs: 120_000, delaysMs: [2_000, 5_000, 15_000] };

/**
 * @param {number[]} history  timestamps (ms) of the restarts already granted
 * @param {number} now        current time (ms)
 * @returns {{ delayMs: number|null, history: number[] }}  null = give up, show the dialog
 */
function nextRestartDelay(history, now, opts = {}) {
  const { windowMs, delaysMs } = { ...DEFAULTS, ...opts };
  const recent = (history || []).filter((t) => now - t < windowMs);
  if (recent.length >= delaysMs.length) return { delayMs: null, history: recent };
  return { delayMs: delaysMs[recent.length], history: [...recent, now] };
}

module.exports = { nextRestartDelay, DEFAULTS };
