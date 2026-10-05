const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/asyncHandler');

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  res.json({ success: true, ...result });
});

module.exports = { login };
