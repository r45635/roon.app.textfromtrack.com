'use strict';

const { Router } = require('express');
const roonRoutes = require('./roonRoutes');
const musicRoutes = require('./musicRoutes');
const tftRoutes = require('./textfromtrackRoutes');
const lrclibRoutes = require('./lrclibRoutes');

const router = Router();

router.use('/roon', roonRoutes);
router.use('/music', musicRoutes);
router.use('/tft', tftRoutes);
router.use('/lrclib', lrclibRoutes);

module.exports = router;
