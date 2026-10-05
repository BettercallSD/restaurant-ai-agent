const bcrypt = require('bcrypt');
const userRepository = require('../repositories/userRepository');
const restaurantUserRepository = require('../repositories/restaurantUserRepository');
const { signStaffToken } = require('../utils/jwt');
const { unauthorized } = require('../errors/AppError');

async function login(email, password) {
  const user = await userRepository.findByEmail(email);
  // Identical error whether the email doesn't exist or the password is wrong — never reveal
  // which one, since that distinction is exactly what lets an attacker enumerate staff emails.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Invalid email or password.');
  }

  const restaurants = await restaurantUserRepository.listForUser(user.id);
  const token = signStaffToken({ sub: user.id });

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name },
    restaurants,
  };
}

module.exports = { login };
