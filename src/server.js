'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./utils/logger');
const apiRouter = require('./api/routes');
const { startRoon } = require('./roon/roonClient');
const { buildError, E } = require('./utils/normalize');

const app = express();

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'TextFromTrack Roon Companion started');
  logger.info(`Open http://localhost:${config.port}`);
});

// Initialise Roon discovery (non-blocking)
try {
  startRoon();
} catch (err) {
  logger.error({ err: err.message }, 'Failed to start Roon discovery');
}

module.exports = app;
