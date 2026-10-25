'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./utils/logger');
const apiRouter = require('./api/routes');
const roonClient = require('./roon/roonClient');
const { watchRoon } = require('./lyrics/nowPlayingLyrics');
const { buildError, E } = require('./utils/normalize');
const { hostGuard, originGuard } = require('./utils/requestGuards');
const { accessGuard } = require('./utils/accessGuard');

const app = express();

// ─── Request guards (no auth, LAN-exposed API) ────────────────────────────────
app.use(hostGuard(config.allowedHosts));
app.use(originGuard);
app.use(accessGuard(config.accessToken));

// ─── Body parsing ─────────────────────────────────────────────────────────────
// The TFT webhook needs its raw body for HMAC verification: parse it first so
// express.json() leaves it alone. No urlencoded parser: browsers can send HTML
// forms cross-site without a preflight, and the UI only posts JSON.
app.use('/api/tft/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── Request logging ──────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url }, 'HTTP request');
  next();
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ─── Serve frontend (production build or after `npm run build`) ───────────────
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
} else {
  app.get('/', (_req, res) => {
    res.send(
      '<h2>TextFromTrack Roon Companion — API running</h2>' +
      '<p>Run <code>npm run build</code> then restart, or use <code>npm run dev:client</code> on port 5173.</p>'
    );
  });
}

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json(buildError(E.UNKNOWN_ERROR, err.message || 'An unexpected error occurred'));
});

// Express 4 does not catch errors thrown by async route handlers: they surface
// as unhandled rejections, which terminate Node by default — one bad request
// would take the whole backend down. Log them instead.
process.on('unhandledRejection', (err) => {
  logger.error({ err: err && err.message, stack: err && err.stack }, 'Unhandled promise rejection');
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'TextFromTrack Roon Companion started');
  logger.info(`Open http://localhost:${config.port}`);

  // Advertise on the LAN via mDNS so Electron instances on other machines can
  // discover this backend and offer to connect to it instead of starting their own.
  try {
    const { Bonjour } = require('bonjour-service');
    const os = require('os');
    const bonjour = new Bonjour();
    const service = bonjour.publish({
      name: `TextFromTrack @ ${os.hostname()}`,
      type: 'textfromtrack',
      port: config.port,
      // Own host name for our A/AAAA records: by default bonjour-service
      // announces os.hostname(), which macOS's mDNSResponder already owns —
      // it sees a conflict and renames the Mac (Name-2, Name-3…) at every start.
      host: `tft-${os.hostname().replace(/\.local$/i, '')}.local`,
      txt: { hostname: os.hostname() },
    });
    // e.g. a second instance on the same host — not fatal, the backend still serves
    service.on('error', (err) => logger.warn({ err: err.message }, 'mDNS advertisement failed'));
    logger.info({ port: config.port }, 'mDNS service advertised (_textfromtrack._tcp)');
    // A signal listener replaces Node's default exit, so exit explicitly —
    // otherwise SIGTERM (Electron quit, docker stop) leaves the backend running.
    const stopBonjour = () => {
      try { bonjour.destroy(); } catch {}
      process.exit(0);
    };
    process.once('SIGTERM', stopBonjour);
    process.once('SIGINT',  stopBonjour);
  } catch (err) {
    logger.warn({ err: err.message }, 'mDNS advertisement skipped');
  }
});

// Initialise Roon discovery (non-blocking)
try {
  roonClient.startRoon();
  watchRoon(roonClient);
} catch (err) {
  logger.error({ err: err.message }, 'Failed to start Roon discovery');
}

// Startup: register TFT webhook if WEBHOOK_BASE_URL is configured (non-blocking)
if (config.tftWebhookBaseUrl) {
  const webhookService = require('./textfromtrack/webhookService');
  webhookService.ensureWebhookRegistered().catch(err =>
    logger.warn({ err: err.message }, 'Webhook registration failed — polling will be used as fallback')
  );
}

module.exports = app;
