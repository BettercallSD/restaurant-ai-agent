const reservationService = require('../services/reservationService');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validationError } = require('../errors/AppError');

function requireIdempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (!key) throw validationError('An Idempotency-Key header is required for this request.');
  return key;
}

// Body shape/types are guaranteed by the `validate(createReservationSchema)` middleware on the
// route before this ever runs — no presence/type checks needed here anymore (Phase 11).
const createReservation = asyncHandler(async (req, res) => {
  const { customer, date, time, partySize, specialRequests } = req.body;
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
  const { date, time, partySize } = req.body;
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
