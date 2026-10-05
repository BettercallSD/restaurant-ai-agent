const { withTransaction } = require('../db/pool');
const reservationRepository = require('../repositories/reservationRepository');
const customerRepository = require('../repositories/customerRepository');
const tableRepository = require('../repositories/tableRepository');
const tableAllocationService = require('./tableAllocationService');
const openingHoursService = require('./openingHoursService');
const { assertReservationTransition } = require('./stateTransitionService');
const { conflict, notFound, validationError } = require('../errors/AppError');
const { toTimestampString, addMinutes } = require('../utils/dateTime');
const { DEFAULT_RESERVATION_DURATION_MINUTES } = require('../config/constants');

const formatReservation = (reservation, tables) => ({
  id: reservation.id,
  status: reservation.status,
  date: reservation.date,
  time: reservation.time,
  partySize: reservation.partySize,
  specialRequests: reservation.specialRequests,
  tables: tables?.map((t) => ({ id: t.id, label: t.label, capacity: t.capacity })),
});

/**
 * Same unavailable-with-alternatives shape used by both create and modify (docs/AI_TOOLS.md).
 * Computed with the advisory (non-locking) check — see tableAllocationService — since nothing is
 * being committed here, just a best-effort "here's what else might work" list.
 */
async function buildAlternatives(restaurant, { date, partySize, durationMinutes, excludeReservationId }) {
  const candidateTimes = openingHoursService.listCandidateTimes(restaurant, date, { reservationDurationMinutes: durationMinutes });
  const available = [];
  for (const time of candidateTimes) {
    const startAt = toTimestampString(date, time);
    const { date: endDate, time: endTime } = addMinutes(date, time, durationMinutes);
    const endAt = toTimestampString(endDate, endTime);
    // eslint-disable-next-line no-await-in-loop -- candidate list is small (opening hours / 30min)
    const allocation = await tableAllocationService.checkAvailability(restaurant, {
      partySize,
      startAt,
      endAt,
      excludeReservationId,
    });
    if (allocation) available.push(time);
  }
  return available;
}

function unavailableError(alternatives) {
  return conflict(
    'RESERVATION_UNAVAILABLE',
    'No table is available at the requested time.',
    { alternatives }
  );
}

async function createReservation(restaurant, { customerPhone, customerName, date, time, partySize, specialRequests, idempotencyKey }) {
  const existing = await reservationRepository.findByIdempotencyKey(restaurant.id, idempotencyKey);
  if (existing) {
    if (existing.date !== date || existing.time.slice(0, 5) !== time || existing.partySize !== partySize) {
      throw conflict(
        'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
        'This idempotency key was already used for a different reservation request.'
      );
    }
    const tableIds = await reservationRepository.findTableIdsForReservation(existing.id);
    const tables = await tableRepository.findByIds(tableIds);
    return formatReservation(existing, tables);
  }

  openingHoursService.assertReservationDateTimeIsBookable(restaurant, date, time);

  const customer = await customerRepository.findOrCreate(restaurant.id, customerPhone, customerName);
  const durationMinutes = DEFAULT_RESERVATION_DURATION_MINUTES;
  const startAt = toTimestampString(date, time);
  const { date: endDate, time: endTime } = addMinutes(date, time, durationMinutes);
  const endAt = toTimestampString(endDate, endTime);

  const result = await withTransaction(async (client) => {
    const allocation = await tableAllocationService.allocateWithLock(client, {
      restaurant,
      partySize,
      startAt,
      endAt,
    });
    if (!allocation) return null;

    const created = await reservationRepository.insert(
      {
        restaurantId: restaurant.id,
        customerId: customer.id,
        partySize,
        date,
        time,
        durationMinutes,
        specialRequests,
        idempotencyKey,
        status: 'CONFIRMED',
      },
      client
    );
    await reservationRepository.insertTables(created.id, allocation.map((t) => t.id), client);
    return { reservation: created, tables: allocation };
  });

  if (!result) {
    const alternatives = await buildAlternatives(restaurant, { date, partySize, durationMinutes });
    throw unavailableError(alternatives);
  }

  return formatReservation(result.reservation, result.tables);
}

async function getReservation(restaurant, { reservationId, customerPhone }) {
  const reservation = reservationId
    ? await reservationRepository.findByIdForRestaurant(reservationId, restaurant.id)
    : await reservationRepository.findMostRecentActiveByPhone(restaurant.id, customerPhone);
  if (!reservation) throw notFound('Reservation');
  const tableIds = await reservationRepository.findTableIdsForReservation(reservation.id);
  const tables = await tableRepository.findByIds(tableIds);
  return formatReservation(reservation, tables);
}

async function modifyReservation(restaurant, reservationId, { partySize, date, time }) {
  const existing = await reservationRepository.findByIdForRestaurant(reservationId, restaurant.id);
  if (!existing) throw notFound('Reservation');
  if (!['PENDING', 'CONFIRMED'].includes(existing.status)) {
    throw conflict(
      'INVALID_RESERVATION_TRANSITION',
      `Cannot modify a reservation that is already ${existing.status}.`
    );
  }

  const newPartySize = partySize ?? existing.partySize;
  const newDate = date ?? existing.date;
  const newTime = time ?? existing.time.slice(0, 5);
  if (!Number.isInteger(newPartySize) || newPartySize <= 0) {
    throw validationError('Party size must be a positive integer.');
  }
  openingHoursService.assertReservationDateTimeIsBookable(restaurant, newDate, newTime);

  const durationMinutes = existing.durationMinutes;
  const startAt = toTimestampString(newDate, newTime);
  const { date: endDate, time: endTime } = addMinutes(newDate, newTime, durationMinutes);
  const endAt = toTimestampString(endDate, endTime);

  const result = await withTransaction(async (client) => {
    const allocation = await tableAllocationService.allocateWithLock(client, {
      restaurant,
      partySize: newPartySize,
      startAt,
      endAt,
      excludeReservationId: existing.id,
    });
    if (!allocation) return null;

    await reservationRepository.clearTables(existing.id, client);
    await reservationRepository.insertTables(existing.id, allocation.map((t) => t.id), client);
    const updated = await reservationRepository.updateSchedule(
      existing.id,
      restaurant.id,
      { partySize: newPartySize, date: newDate, time: newTime, durationMinutes },
      client
    );
    return { reservation: updated, tables: allocation };
  });

  if (!result) {
    const alternatives = await buildAlternatives(restaurant, {
      date: newDate,
      partySize: newPartySize,
      durationMinutes,
      excludeReservationId: existing.id,
    });
    throw unavailableError(alternatives);
  }

  return formatReservation(result.reservation, result.tables);
}

async function cancelReservation(restaurant, reservationId) {
  const existing = await reservationRepository.findByIdForRestaurant(reservationId, restaurant.id);
  if (!existing) throw notFound('Reservation');

  // Idempotent: cancelling an already-cancelled reservation succeeds without erroring
  // (docs/AI_TOOLS.md) rather than treating CANCELLED -> CANCELLED as an invalid transition.
  if (existing.status === 'CANCELLED') {
    return formatReservation(existing);
  }

  assertReservationTransition(existing.status, 'CANCELLED');
  const updated = await withTransaction((client) =>
    reservationRepository.updateStatus(existing.id, restaurant.id, 'CANCELLED', client)
  );
  return formatReservation(updated);
}

module.exports = { createReservation, getReservation, modifyReservation, cancelReservation, buildAlternatives };
