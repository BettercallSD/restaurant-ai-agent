const express = require('express');
const restaurantRoutes = require('./restaurantRoutes');
const authRoutes = require('./authRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/restaurants', restaurantRoutes);

module.exports = router;
