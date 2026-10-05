const reservationService = require('../services/reservationService');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validationError } = require('../errors/AppError');

/**
 * Explicit field whitelisting, not `req.body` spread — this is what makes mass-assignment
 * impossible by construction rather than by review discipline (docs/SECURITY.md). A client can
 * send `{ status: 'CONFIRMED', restaurantId: '...' }` in the body and it is simply never read.
 *
 * Full zod schemas land in Phase 11; these are deliberately minimal presence/type checks so the
 * route doesn't crash with a confusing 500 on an obviously malformed request in the meantime.
 */
function requireIdempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (!key) throw validationError('An Idempotency-Key header is required for this request.');
  return key;
}

const createReservation = asyncHandler(async (req, res) => {
  const { customer, date, time, partySize, specialRequests } = req.body ?? {};
  if (!customer?.phone || !date || !time || !Number.isInteger(partySize)) {
    throw validationError('customer.phone, date, time, and partySize (integer) are required.');
  }
  const idempotencyKey = requireIdempotencyKey(req);

  const reservation = await reservationService.createReservation(req.restaurant, {
    customerPhone: customer.phone,
    customerName: customer.name,
    date,
    time,
    partySize,
    specialRequests,
    idempotencyKey,
  });
  res.status(201).json({ success: true, reservation });
});

const getReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.getReservation(req.restaurant, {
    reservationId: req.params.reservationId,
  });
  res.json({ success: true, reservation });
});

const modifyReservation = asyncHandler(async (req, res) => {
  const { date, time, partySize } = req.body ?? {};
  if (date === undefined && time === undefined && partySize === undefined) {
    throw validationError('At least one of date, time, or partySize must be provided.');
  }
  const reservation = await reservationService.modifyReservation(req.restaurant, req.params.reservationId, {
    date,
    time,
    partySize,
  });
  res.json({ success: true, reservation });
});

const cancelReservation = asyncHandler(async (req, res) => {
  const reservation = await reservationService.cancelReservation(req.restaurant, req.params.reservationId);
  res.json({ success: true, reservation });
});

module.exports = { createReservation, getReservation, modifyReservation, cancelReservation };
