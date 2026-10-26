// ─── Screenshot mode ─────────────────────────────────────────────────────────
// Replaces personal names in what the UI shows (Roon Core name, zone and speaker
// names, account e-mail, credits, file paths) with neutral ones, so screenshots
// and bug reports can be shared. Display only: nothing is changed in Roon or on disk.
// On with App Preferences → "Screenshot mode", or a URL with ?privacy=1 (?privacy=0 off).

const KEY = 'tft:privacy';
const NAMES = {
  en: {
    zones: ['Living Room', 'Kitchen', 'Office', 'Bedroom', 'Studio', 'Terrace', 'Library', 'Garage'],
    speaker: 'Speaker', zone: 'Zone', core: 'Roon Core', email: 'listener@example.com',
  },
  fr: {
    zones: ['Salon', 'Cuisine', 'Bureau', 'Chambre', 'Studio', 'Terrasse', 'Bibliothèque', 'Garage'],
    speaker: 'Enceinte', zone: 'Zone', core: 'Roon Core', email: 'auditeur@example.com',
  },
};
// The UI language as i18next stores it (updated by the EN / FR buttons).
function language() {
  try { return (localStorage.getItem('i18nextLng') || navigator.language || 'en').slice(0, 2); } catch { return 'en'; }
}
const names = () => NAMES[language()] || NAMES.en;

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

// Each zone / speaker gets a slot number once, remembered in localStorage, so it keeps the
// same neutral name on every page (main UI, phone, kiosk), after a reload, in every language.
const SLOTS_KEY = 'tft:privacySlots';
function slot(kind, id) {
  let slots;
  try { slots = JSON.parse(localStorage.getItem(SLOTS_KEY)) || {}; } catch { slots = {}; }
  const table = slots[kind] || (slots[kind] = {});
  if (table[id] == null) {
    table[id] = Object.keys(table).length;
    try { localStorage.setItem(SLOTS_KEY, JSON.stringify(slots)); } catch { /* storage blocked */ }
  }
  return table[id];
}
function zoneName(id) {
  const n = names(); const i = id ? slot('zones', id) : 0;
  return n.zones[i] || `${n.zone} ${i + 1}`;
}
function outputName(id) {
  const n = names(); const i = id ? slot('outputs', id) : 0;
  return `${n.speaker} ${String.fromCharCode(65 + (i % 26))}`;
}

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
  return { ...status, core_name: status.core_name ? names().core : status.core_name, last_connect_error: null };
}

export function maskAccount(account) {
  if (!isPrivacyMode() || !account) return account;
  return { ...account, email: account.email ? names().email : account.email };
}

let knownRoots = [];

/** The configured music folders: maskPath then replaces exactly that prefix, however deep the files sit. */
export function setKnownRoots(roots) {
  knownRoots = (roots || []).map(r => String(r).replace(/\/+$/, '')).filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

/**
 * "/Volumes/My Passport/HiRes Music/Artist/Album/01 Song.flac" → "/Music/Artist/Album/01 Song.flac".
 * A music folder itself becomes "/Music". Without known folders, the last three parts are kept.
 */
export function maskPath(p) {
  if (!isPrivacyMode() || !p) return p;
  const root = knownRoots.find(r => p === r || p.startsWith(r + '/'));
  if (root) return '/Music' + p.slice(root.length);
  const parts = p.split('/').filter(Boolean);
  return '/Music/' + parts.slice(-3).join('/');
}
