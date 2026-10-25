'use strict';

/**
 * HTTP guards for an API that has no authentication and listens on the LAN.
 *
 * - hostGuard: rejects requests whose Host is a public domain name. A web page
 *   can rebind its own domain to 127.0.0.1 / a LAN IP (DNS rebinding) and then
 *   read and drive the API as same-origin; such requests still carry the
 *   attacker's domain in Host.
 * - originGuard: rejects state-changing requests sent by a browser from another
 *   origin (CSRF from any open web page). Non-browser clients (Electron main,
 *   curl, the TFT webhook) send no Origin and are not affected.
 */

const net = require('net');
const os = require('os');
const { buildError } = require('./normalize');

// Home-network names that cannot be registered publicly.
const PRIVATE_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain'];

function parseAllowedHosts(value) {
  return (value || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedHost(hostname, allowed) {
  const host = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (allowed.includes('*') || allowed.includes(host)) return true;
  if (host === 'localhost' || net.isIP(host)) return true;
  if (!host.includes('.')) return true; // single-label LAN name (e.g. "nas")
  if (host === os.hostname().toLowerCase()) return true;
  return PRIVATE_SUFFIXES.some(suffix => host.endsWith(suffix));
}

function hostGuard(allowedHostsValue) {
  const allowed = parseAllowedHosts(allowedHostsValue);
  return (req, res, next) => {
    if (isAllowedHost(req.hostname, allowed)) return next();
    res.status(403).json(buildError('FORBIDDEN_HOST',
      `Host "${req.hostname}" is not allowed — add it to ALLOWED_HOSTS if this is your own domain`));
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.get('host')) return next();
  } catch { /* malformed Origin → reject */ }
  res.status(403).json(buildError('FORBIDDEN_ORIGIN', 'Cross-origin requests are not allowed'));
}

module.exports = { hostGuard, originGuard, isAllowedHost, parseAllowedHosts };
