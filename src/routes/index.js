const express = require('express');
const restaurantRoutes = require('./restaurantRoutes');
const authRoutes = require('./authRoutes');
const aiToolRoutes = require('./aiToolRoutes');
const { authenticate } = require('../middleware/authenticate');
const { requireAiActor } = require('../middleware/requireAiActor');
const { aiToolLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/restaurants', restaurantRoutes);
router.use('/ai/tools', aiToolLimiter, authenticate, requireAiActor, aiToolRoutes);

module.exports = router;
