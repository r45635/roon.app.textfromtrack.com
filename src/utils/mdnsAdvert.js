'use strict';

/**
 * What the companion says about itself on the LAN (mDNS `_textfromtrack._tcp`). Kept pure so
 * the record is tested without a socket; server.js publishes it.
 *
 * TXT keys:
 *   hostname  the machine, for people
 *   roon      'yes' when this host also knows what is playing, 'no' for a lyrics server alone
 *   version   this companion's version, for a screen's status page
 *   api       'get' — the contract a TFT Panel reads: a companion that publishes it answers
 *             LRCLIB's own GET /api/get from the player's chain (local files, corrections,
 *             timing offset), so the panel asks that instead of the bare /api/lrclib/lookup.
 *             Companions before 0.7.1 publish no `api`; a panel keeps calling lookup on those.
 */
function txtRecord({ hostname, roonEnabled, version }) {
  return {
    hostname: String(hostname || ''),
    roon: roonEnabled ? 'yes' : 'no',
    version: String(version || 'unknown'),
    api: 'get',
  };
}

/**
 * Own host name for the service's A/AAAA records. By default bonjour-service announces
 * os.hostname(), which macOS's mDNSResponder already owns — it sees a conflict and renames the
 * Mac (Name-2, Name-3…) at every start.
 */
function serviceHost(hostname) {
  return `tft-${String(hostname || 'companion').replace(/\.local$/i, '')}.local`;
}

module.exports = { txtRecord, serviceHost };
