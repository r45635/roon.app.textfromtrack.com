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

// Stable neutral names, in order of first appearance.
const zoneNames = new Map();
const outputNames = new Map();
function neutral(map, id, list, prefix) {
  if (!id) return list[0];
  if (!map.has(id)) map.set(id, list[map.size] || `${prefix} ${map.size + 1}`);
  return map.get(id);
}
const zoneName = (id) => neutral(zoneNames, id, ZONE_NAMES, 'Zone');
const outputName = (id) => neutral(outputNames, id, OUTPUT_NAMES, 'Speaker');

function maskOutputs(outputs) {
  return (outputs || []).map(o => ({ ...o, display_name: outputName(o.output_id) }));
}

export function maskZones(zones) {
  if (!isPrivacyMode() || !Array.isArray(zones)) return zones;
  return zones.map(z => ({ ...z, display_name: zoneName(z.zone_id), outputs: maskOutputs(z.outputs) }));
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
