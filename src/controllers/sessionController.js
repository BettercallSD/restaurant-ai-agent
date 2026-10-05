const sessionRepository = require('../repositories/sessionRepository');
const { asyncHandler } = require('../middleware/asyncHandler');
const { notFound } = require('../errors/AppError');
const { signAiSessionToken } = require('../utils/jwt');

const formatSession = (session) => ({
  id: session.id,
  restaurantId: session.restaurantId,
  channel: session.channel,
  state: session.state,
  status: session.status,
});

/**
 * Public (no auth) by design — this is the credential-issuing endpoint. Everything that acts on
 * an existing session requires the `aiToken` this returns; see docs/DECISIONS.md.
 */
const createSession = asyncHandler(async (req, res) => {
  const { customerPhone, channel } = req.body;
  const session = await sessionRepository.create(req.restaurant.id, customerPhone, channel || 'voice');
  const aiToken = signAiSessionToken({ sessionId: session.id, restaurantId: req.restaurant.id });
  res.status(201).json({ success: true, session: formatSession(session), aiToken });
});

/**
 * Beyond `authorizeActor`'s restaurant-level check, an AI actor must also be scoped to THIS
 * specific session — otherwise any session token for a restaurant could read every other call's
 * session under the same restaurant, not just its own. Staff aren't restricted this way: a
 * dashboard user authorized for the restaurant can look at any of its sessions.
 */
function assertCanAccessSession(req, session) {
  if (!session || session.restaurantId !== req.restaurant.id) throw notFound('Session');
  if (req.actor.type === 'ai' && req.actor.sessionId !== session.id) throw notFound('Session');
}

const getSession = asyncHandler(async (req, res) => {
  const session = await sessionRepository.findById(req.params.sessionId);
  assertCanAccessSession(req, session);
  res.json({ success: true, session: formatSession(session) });
});

const patchSessionState = asyncHandler(async (req, res) => {
  const existing = await sessionRepository.findById(req.params.sessionId);
  assertCanAccessSession(req, existing);
  const updated = await sessionRepository.patchState(req.params.sessionId, req.body.state);
  res.json({ success: true, session: formatSession(updated) });
});

const appendMessage = asyncHandler(async (req, res) => {
  const existing = await sessionRepository.findById(req.params.sessionId);
  assertCanAccessSession(req, existing);
  const { role, content } = req.body;
  // Stored and later returned verbatim as a JSON string field, never rendered as HTML anywhere in
  // this API (docs/SECURITY.md) — no sanitization needed, length bound is already enforced by the
  // zod schema.
  await sessionRepository.appendMessage(req.params.sessionId, role, content);
  res.status(201).json({ success: true });
});

module.exports = { createSession, getSession, patchSessionState, appendMessage };
