const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Two separate signing secrets for two separate trust domains (docs/SECURITY.md): a staff JWT
 * proves "this is an authenticated dashboard user"; an AI session token proves "this is the
 * orchestrator for one specific phone call, scoped to one restaurant". Keeping them on different
 * secrets means a leak of one never lets someone forge the other, and `authenticate.js` can tell
 * which kind of token it's looking at just by which secret verifies it.
 */

const signStaffToken = (payload) => jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
const verifyStaffToken = (token) => jwt.verify(token, env.JWT_SECRET);

// 4 hours comfortably covers any real phone call; the session itself is what actually scopes what
// the token can do (a specific restaurant + session id), so a generous expiry here isn't a
// meaningful blast-radius increase.
const signAiSessionToken = (payload) => jwt.sign(payload, env.AI_SESSION_SECRET, { expiresIn: '4h' });
const verifyAiSessionToken = (token) => jwt.verify(token, env.AI_SESSION_SECRET);

module.exports = { signStaffToken, verifyStaffToken, signAiSessionToken, verifyAiSessionToken };
