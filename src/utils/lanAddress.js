'use strict';

const os = require('os');

/**
 * The IPv4 address other devices on the home network can reach this machine at — for the
 * phone QR code and "Open on Network". The first non-internal address is often the wrong
 * one: a self-assigned 169.254.x (Thunderbolt bridge, AWDL), a VPN / Tailscale 100.64/10, or a
 * Docker / VM bridge. Prefer a private LAN address on a Wi-Fi or Ethernet interface.
 */

const VIRTUAL_IFACE_RE = /^(utun|tun|tap|ppp|ipsec|wg|tailscale|zt|docker|br-|veth|virbr|vboxnet|vmnet|bridge|awdl|llw|anpi|ap\d)/i;
const PREFERRED_IFACE_RE = /^(en0|en1|eth0|eth1|wlan0|wlp|enp|eno|Wi-?Fi|Ethernet)/i;

function isPrivate(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function isUnreachableForLan(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * @param {object} [interfaces] os.networkInterfaces() shape (for tests)
 * @returns {string|null}
 */
function getLanAddress(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces || {})) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || isUnreachableForLan(a.address)) continue;
      let score = 0;
      if (isPrivate(a.address)) score += 4;
      if (PREFERRED_IFACE_RE.test(name)) score += 2;
      if (VIRTUAL_IFACE_RE.test(name)) score -= 3;
      candidates.push({ address: a.address, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  return candidates.length ? candidates[0].address : null;
}

module.exports = { getLanAddress };
