const express = require('express');
const restaurantRoutes = require('./restaurantRoutes');

const router = express.Router();

router.use('/restaurants', restaurantRoutes);

module.exports = router;
