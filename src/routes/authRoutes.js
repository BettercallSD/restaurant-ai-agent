const express = require('express');
const controller = require('../controllers/authController');
const { validate } = require('../middleware/validate');
const { loginSchema } = require('../validators/authValidators');
const { authLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/login', authLimiter, validate(loginSchema), controller.login);

module.exports = router;
