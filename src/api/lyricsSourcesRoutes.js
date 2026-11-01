'use strict';

/**
 * The ordered list of LRCLIB servers lyrics are fetched from (lrclib.net and/or mirrors).
 */

const { Router } = require('express');
const logger = require('../utils/logger');
const { buildError, E } = require('../utils/normalize');
const userSettings = require('../settings/userSettings');
const lrclibClient = require('../lyrics/lrclibClient');

const router = Router();

function sourcesResponse() {
  return { success: true, ...lrclibClient.getServers() };
}

/**
 * GET /api/lyrics-sources
 * Returns { urls, source: 'user_settings'|'env'|'default' }.
 */
router.get('/', (req, res) => {
  res.json(sourcesResponse());
});

/**
 * POST /api/lyrics-sources
 * Body: { urls: string[] } in preference order; [] goes back to LRCLIB_URLS, else lrclib.net.
 * An invalid entry is refused with its reason, never dropped.
 */
router.post('/', (req, res) => {
  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.some(u => typeof u !== 'string')) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'urls must be an array of strings'));
  }
  let cleaned;
  try {
    cleaned = lrclibClient.normalizeServerList(urls);
  } catch (err) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, err.message));
  }
  userSettings.set({ lrclib_urls: cleaned });
  lrclibClient.clearCooldowns();
  logger.info({ urls: cleaned }, 'LRCLIB servers updated');
  res.json(sourcesResponse());
});

/**
 * POST /api/lyrics-sources/test
 * Body: { url }. Asks that server for record 1 (not /healthz, which only proves a proxy is up).
 * Returns { ok, status, ms, error }.
 */
router.post('/test', async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== 'string') {
    return res.status(400).json(buildError(E.INVALID_REQUEST, 'url must be a string'));
  }
  try {
    lrclibClient.normalizeServerUrl(url);
  } catch (err) {
    return res.status(400).json(buildError(E.INVALID_REQUEST, err.message));
  }
  res.json({ success: true, ...(await lrclibClient.probe(url)) });
});

module.exports = router;
