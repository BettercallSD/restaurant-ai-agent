const sessionRepository = require('../repositories/sessionRepository');
const { asyncHandler } = require('../middleware/asyncHandler');
const { notFound, validationError } = require('../errors/AppError');

const formatSession = (session) => ({
  id: session.id,
  restaurantId: session.restaurantId,
  channel: session.channel,
  state: session.state,
  status: session.status,
});

/**
 * ⚠️ Phase 10 only: anyone who can call this endpoint can open a session for any restaurant id.
 * Phase 11 issues the actual session-scoped AI token here and requires it on every subsequent
 * tool call — see docs/SECURITY.md's "AI orchestration" auth model. Until then this is plumbing,
 * not a security boundary.
 */
const createSession = asyncHandler(async (req, res) => {
  const { customerPhone, channel } = req.body ?? {};
  const session = await sessionRepository.create(req.restaurant.id, customerPhone, channel || 'voice');
  res.status(201).json({ success: true, session: formatSession(session) });
});

const getSession = asyncHandler(async (req, res) => {
  const session = await sessionRepository.findById(req.params.sessionId);
  if (!session || session.restaurantId !== req.restaurant.id) throw notFound('Session');
  res.json({ success: true, session: formatSession(session) });
});

const patchSessionState = asyncHandler(async (req, res) => {
  const existing = await sessionRepository.findById(req.params.sessionId);
  if (!existing || existing.restaurantId !== req.restaurant.id) throw notFound('Session');

  const patch = req.body?.state;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw validationError('Request body must be { "state": { ...fields to merge } }.');
  }
  const updated = await sessionRepository.patchState(req.params.sessionId, patch);
  res.json({ success: true, session: formatSession(updated) });
});

const appendMessage = asyncHandler(async (req, res) => {
  const existing = await sessionRepository.findById(req.params.sessionId);
  if (!existing || existing.restaurantId !== req.restaurant.id) throw notFound('Session');

  const { role, content } = req.body ?? {};
  if (!['customer', 'ai', 'system'].includes(role) || typeof content !== 'string' || !content.trim()) {
    throw validationError('role must be one of customer/ai/system, and content must be non-empty text.');
  }
  // content is stored and later returned verbatim as a JSON string field, never rendered as HTML
  // anywhere in this API (docs/SECURITY.md) — no sanitization needed here, only a length cap.
  await sessionRepository.appendMessage(req.params.sessionId, role, content.slice(0, 4000));
  res.status(201).json({ success: true });
});

module.exports = { createSession, getSession, patchSessionState, appendMessage };
