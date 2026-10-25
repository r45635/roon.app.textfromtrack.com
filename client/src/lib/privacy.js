// ─── Screenshot mode ─────────────────────────────────────────────────────────
// Replaces personal names in what the UI shows (Roon Core name, zone and speaker
// names, account e-mail, credits, file paths) with neutral ones, so screenshots
// and bug reports can be shared. Display only: nothing is changed in Roon or on disk.
// On with App Preferences → "Screenshot mode", or a URL with ?privacy=1 (?privacy=0 off).

const KEY = 'tft:privacy';
const ZONE_NAMES = ['Living Room', 'Kitchen', 'Office', 'Bedroom', 'Studio', 'Terrace', 'Library', 'Garage'];
const OUTPUT_NAMES = ['Speaker A', 'Speaker B', 'Speaker C', 'Speaker D', 'Speaker E', 'Speaker F', 'Speaker G', 'Speaker H'];

(function readUrlSwitch() {
  try {
    const p = new URLSearchParams(window.location.search).get('privacy');
    if (p === '1') localStorage.setItem(KEY, '1');
    if (p === '0') localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
})();

export function isPrivacyMode() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setPrivacyMode(on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
}

// Neutral names are given once per zone / speaker and remembered in localStorage, so a
// zone keeps the same name on every page (main UI, phone, kiosk) and after a reload.
const NAMES_KEY = 'tft:privacyNames';
function loadNames() {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY)) || { zones: {}, outputs: {} }; } catch { return { zones: {}, outputs: {} }; }
}
function neutral(kind, id, list, prefix) {
  if (!id) return list[0];
  const names = loadNames();
  const table = names[kind] || (names[kind] = {});
  if (!table[id]) {
    const n = Object.keys(table).length;
    table[id] = list[n] || `${prefix} ${n + 1}`;
    try { localStorage.setItem(NAMES_KEY, JSON.stringify(names)); } catch { /* storage blocked */ }
  }
  return table[id];
}
const zoneName = (id) => neutral('zones', id, ZONE_NAMES, 'Zone');
const outputName = (id) => neutral('outputs', id, OUTPUT_NAMES, 'Speaker');

function maskOutputs(outputs) {
  return (outputs || []).map(o => ({ ...o, display_name: outputName(o.output_id) }));
}

/**
 * What paused or stopped zones last played is personal too (and often a commercial cover):
 * only zones that are playing right now keep their track and cover.
 */
export function maskZones(zones) {
  if (!isPrivacyMode() || !Array.isArray(zones)) return zones;
  return zones.map(z => {
    const masked = { ...z, display_name: zoneName(z.zone_id), outputs: maskOutputs(z.outputs) };
    if (z.state !== 'playing') {
      masked.now_playing_title = null;
      masked.now_playing_artist = null;
      masked.image_key = null;
    }
    return masked;
  });
}

export function maskNowPlaying(np) {
  if (!isPrivacyMode() || !np) return np;
  return { ...np, zone_name: zoneName(np.zone_id), outputs: maskOutputs(np.outputs) };
}

export function maskRoonStatus(status) {
  if (!isPrivacyMode() || !status) return status;
  return { ...status, core_name: status.core_name ? 'Roon Core' : status.core_name, last_connect_error: null };
}

export function maskAccount(account) {
  if (!isPrivacyMode() || !account) return account;
  return { ...account, email: account.email ? 'listener@example.com' : account.email };
}

/** "/Volumes/My Passport/HiRes Music/Artist/Album/01 Song.flac" → "/Music/Artist/Album/01 Song.flac" */
export function maskPath(p) {
  if (!isPrivacyMode() || !p) return p;
  const parts = p.split('/').filter(Boolean);
  return '/Music/' + parts.slice(-3).join('/');
}
