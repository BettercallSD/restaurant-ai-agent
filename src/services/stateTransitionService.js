const { AppError } = require('../errors/AppError');

/**
 * Exactly the state machine documented in docs/AGENT_FLOW.md. Checked here, once, and used by
 * both the dashboard-facing and AI-tool-facing code paths (Phase 7+) so neither can take a
 * shortcut the other doesn't get.
 */
const RESERVATION_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED', 'NO_SHOW', 'COMPLETED'],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

const ORDER_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

function canTransition(transitions, from, to) {
  return (transitions[from] ?? []).includes(to);
}

/**
 * Cancelling an already-cancelled reservation/order is treated as an idempotent success by the
 * calling service (docs/AI_TOOLS.md), not as a transition at all — callers check for that
 * same-state case themselves before calling this, so this function stays a strict "is X -> Y a
 * real transition" check with no special-casing baked in.
 */
function assertReservationTransition(from, to) {
  if (!canTransition(RESERVATION_TRANSITIONS, from, to)) {
    throw new AppError(
      'INVALID_RESERVATION_TRANSITION',
      `Cannot move a reservation from ${from} to ${to}.`,
      409
    );
  }
}

function assertOrderTransition(from, to) {
  if (!canTransition(ORDER_TRANSITIONS, from, to)) {
    throw new AppError('INVALID_ORDER_TRANSITION', `Cannot move an order from ${from} to ${to}.`, 409);
  }
}

module.exports = {
  RESERVATION_TRANSITIONS,
  ORDER_TRANSITIONS,
  assertReservationTransition,
  assertOrderTransition,
};
