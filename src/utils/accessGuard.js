'use strict';

/**
 * Optional access token for the UI and API (ACCESS_TOKEN). Off when unset — the default,
 * which keeps today's LAN behaviour. When set, every request needs the token, except:
 *   - requests from this machine itself (Electron tray, local browser), unless they came
 *     through a proxy (X-Forwarded-For) — a local reverse proxy must not open the door;
 *   - the TFT webhook, which carries its own HMAC signature.
 *
 * The token is accepted as `Authorization: Bearer <token>`, as the `tft_access` cookie, or as
 * `?access_token=<token>` on a page load — that one sets the cookie and redirects without
 * the token in the URL, so a kiosk or phone can be set up from a single link.
 */

const crypto = require('crypto');
const { buildError } = require('./normalize');

const COOKIE = 'tft_access';
const EXEMPT_PATHS = new Set(['/api/tft/webhook']);
const ONE_YEAR_S = 365 * 24 * 3600;

function sameToken(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function isLoopback(req) {
  if (req.headers['x-forwarded-for']) return false;
  const addr = req.socket?.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access token — TextFromTrack</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#151513;color:#ecebe4;
    min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:16px}
  form{background:#201f1c;border-radius:14px;padding:28px;max-width:360px;width:100%;display:flex;flex-direction:column;gap:12px}
  h1{font-size:18px;margin:0} p{font-size:13px;color:#a9a69f;margin:0;line-height:1.5}
  input{padding:10px;border-radius:8px;border:1px solid #36352f;background:#141412;color:inherit;font-size:14px}
  button{padding:10px;border-radius:8px;border:0;background:#ecebe4;color:#141412;font-size:14px;cursor:pointer}
</style></head><body>
<form method="get" action="/">
  <h1>TextFromTrack Roon Companion</h1>
  <p>This companion asks for its access token (the <code>ACCESS_TOKEN</code> it was started with).</p>
  <input name="access_token" type="password" autocomplete="current-password" placeholder="Access token" required autofocus>
  <button type="submit">Open</button>
</form></body></html>`;

/**
 * @param {string} token ACCESS_TOKEN; empty = guard disabled
 */
function accessGuard(token) {
  if (!token) return (req, res, next) => next();
  return (req, res, next) => {
    if (EXEMPT_PATHS.has(req.path) || isLoopback(req)) return next();

    const queryToken = typeof req.query?.access_token === 'string' ? req.query.access_token : null;
    if (queryToken && req.method === 'GET' && sameToken(queryToken, token)) {
      res.setHeader('Set-Cookie',
        `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ONE_YEAR_S}; HttpOnly; SameSite=Lax`);
      const url = new URL(req.originalUrl, 'http://x');
      url.searchParams.delete('access_token');
      return res.redirect(302, url.pathname + url.search);
    }

    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const cookie = readCookie(req, COOKIE);
    if ((bearer && sameToken(bearer, token)) || (cookie && sameToken(cookie, token))) return next();

    if (req.path.startsWith('/api/')) {
      return res.status(401).json(buildError('ACCESS_TOKEN_REQUIRED', 'This companion requires its access token'));
    }
    res.status(401).type('html').send(LOGIN_PAGE);
  };
}

module.exports = { accessGuard, COOKIE };
