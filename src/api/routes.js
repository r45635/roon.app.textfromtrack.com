'use strict';

const { Router } = require('express');
const roonRoutes = require('./roonRoutes');
const musicRoutes = require('./musicRoutes');
const tftRoutes = require('./textfromtrackRoutes');
const lrclibRoutes = require('./lrclibRoutes');
const lyricsRoutes = require('./lyricsRoutes');
const libraryRoutes = require('./libraryRoutes');
const debugRoutes = require('./debugRoutes');
const qrRoutes = require('./qrRoutes');
const { getUpdateInfo } = require('../utils/updateCheck');

const router = Router();

router.use('/roon', roonRoutes);
router.use('/music', musicRoutes);
router.use('/tft', tftRoutes);
router.use('/lrclib', lrclibRoutes);
router.use('/lyrics', lyricsRoutes);
router.use('/library', libraryRoutes);
router.use('/debug', debugRoutes);
router.use('/qr', qrRoutes);

/**
 * GET /api/update — is a newer release published on GitHub? (cached 6 h, UPDATE_CHECK=false disables)
 */
router.get('/update', async (req, res) => {
  res.json({ success: true, ...(await getUpdateInfo()) });
});

module.exports = router;
