const bcrypt = require('bcrypt');
const userRepository = require('../repositories/userRepository');
const restaurantUserRepository = require('../repositories/restaurantUserRepository');
const { signStaffToken } = require('../utils/jwt');
const { unauthorized } = require('../errors/AppError');

// A real bcrypt hash of an arbitrary, unused value — compared against when no user is found, so
// bcrypt.compare runs (and takes its usual ~250-300ms) on every login attempt regardless of
// whether the email exists. Found during the Phase 17 audit that the identical *error message*
// (the original mitigation) did nothing against this: short-circuit evaluation meant a
// nonexistent email returned in ~1.5ms while a real email with a wrong password took ~300ms — a
// trivially measurable, 200x timing side-channel that lets an attacker enumerate staff emails by
// response time alone, completely bypassing the identical wording.
const DUMMY_HASH = '$2b$12$fPEdWpCQaeW2ftUUSbQlQOkhc.30C2Ff4cgFWZL./.kElK/9YjvD6';

async function login(email, password) {
  const user = await userRepository.findByEmail(email);
  const passwordMatches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !passwordMatches) {
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
