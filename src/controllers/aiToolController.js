const menuRepository = require('../repositories/menuRepository');
const aiActionRepository = require('../repositories/aiActionRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const reservationService = require('../services/reservationService');
const orderService = require('../services/orderService');
const tableAllocationService = require('../services/tableAllocationService');
const openingHoursService = require('../services/openingHoursService');
const { notFound } = require('../errors/AppError');
const { toTimestampString, addMinutes } = require('../utils/dateTime');
const { DEFAULT_RESERVATION_DURATION_MINUTES } = require('../config/constants');

/**
 * Every tool call is logged to `ai_actions` — success or failure — which is what lets the
 * dashboard show a live trace like docs/AI_TOOLS.md's example ("AI → check_availability() →
 * RESULT → unavailable → AI → find_alternative_times() → ..."). `sanitizedInput` is the
 * zod-validated body (never raw headers/tokens); `sanitizedResult` is exactly the structured
 * object handed back to the AI, nothing more. A logging failure never breaks the actual response
 * — it's best-effort telemetry, not part of the business transaction.
 *
 * Each `handler` is a plain `async (req) => resultObject` — it never touches `res` directly, which
 * is what keeps the response envelope (`{ success: true, ...result }` or the error envelope on
 * failure) identical across all thirteen tools without repeating it in each one.
 */
function tool(toolName, handler) {
  return async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const result = await handler(req);
      await aiActionRepository
        .record({
          sessionId: req.actor.sessionId,
          restaurantId: req.restaurant.id,
          toolName,
          status: 'SUCCESS',
          durationMs: Date.now() - startedAt,
          sanitizedInput: req.body,
          sanitizedResult: result,
        })
        .catch(() => {});
      res.json({ success: true, ...result });
    } catch (err) {
      await aiActionRepository
        .record({
          sessionId: req.actor?.sessionId,
          restaurantId: req.restaurant?.id,
          toolName,
          status: 'FAILURE',
          durationMs: Date.now() - startedAt,
          sanitizedInput: req.body,
          sanitizedResult: { code: err.code ?? 'INTERNAL_ERROR', message: err.code ? err.message : undefined },
        })
        .catch(() => {});
      next(err);
    }
  };
}

const getRestaurantInfo = tool('get_restaurant_info', async (req) => {
  const { restaurant } = req;
  return {
    name: restaurant.name,
    phone: restaurant.phone,
    address: restaurant.address,
    openingHours: restaurant.openingHours,
    timezone: restaurant.timezone,
  };
});

const getMenu = tool('get_menu', async (req) => {
  const { categoryId } = req.body;
  const categories = await menuRepository.listCategories(req.restaurant.id);
  const items = await menuRepository.listItems(req.restaurant.id, { categoryId });
  const itemsByCategory = new Map(categories.map((c) => [c.id, []]));
  for (const item of items) {
    itemsByCategory.get(item.categoryId)?.push({
      id: item.id,
      name: item.name,
      description: item.description,
      priceCents: item.priceCents,
      isAvailable: item.isAvailable,
    });
  }
  return { categories: categories.map((c) => ({ id: c.id, name: c.name, items: itemsByCategory.get(c.id) ?? [] })) };
});

const checkItemAvailability = tool('check_item_availability', async (req) => {
  const item = await menuRepository.findByIdForRestaurant(req.body.menuItemId, req.restaurant.id);
  if (!item) throw notFound('Menu item');
  return { available: item.isAvailable, name: item.name, priceCents: item.priceCents };
});

const checkTableAvailability = tool('check_table_availability', async (req) => {
  const { date, time, partySize } = req.body;
  const { restaurant } = req;
  openingHoursService.assertReservationDateTimeIsBookable(restaurant, date, time);

  const startAt = toTimestampString(date, time);
  const { date: endDate, time: endTime } = addMinutes(date, time, DEFAULT_RESERVATION_DURATION_MINUTES);
  const endAt = toTimestampString(endDate, endTime);

  const allocation = await tableAllocationService.checkAvailability(restaurant, { partySize, startAt, endAt });
  if (allocation) {
    return { available: true, options: allocation.map((t) => ({ tableId: t.id, capacity: t.capacity })) };
  }
  const alternatives = await reservationService.buildAlternatives(restaurant, {
    date,
    partySize,
    durationMinutes: DEFAULT_RESERVATION_DURATION_MINUTES,
  });
  return { available: false, alternatives };
});

const findAlternativeTimes = tool('find_alternative_times', async (req) => {
  const { date, partySize, preferredTime } = req.body;
  const times = await reservationService.buildAlternatives(req.restaurant, {
    date,
    partySize,
    durationMinutes: DEFAULT_RESERVATION_DURATION_MINUTES,
  });
  if (!preferredTime) return { times };
  // Closest-to-preferred first — a small, genuinely useful touch: the AI should offer the
  // nearest alternative first, not an arbitrary one, when the customer named a time they wanted.
  const toMinutes = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const target = toMinutes(preferredTime);
  const sorted = [...times].sort((a, b) => Math.abs(toMinutes(a) - target) - Math.abs(toMinutes(b) - target));
  return { times: sorted };
});

const createReservation = tool('create_reservation', async (req) => {
  const { customerName, customerPhone, date, time, partySize, specialRequests, idempotencyKey } = req.body;
  const reservation = await reservationService.createReservation(req.restaurant, {
    customerPhone,
    customerName,
    date,
    time,
    partySize,
    specialRequests,
    idempotencyKey,
  });
  return { reservationId: reservation.id, status: reservation.status, date: reservation.date, time: reservation.time, partySize: reservation.partySize };
});

const getReservation = tool('get_reservation', async (req) => {
  const { reservationId, customerPhone } = req.body;
  const reservation = await reservationService.getReservation(req.restaurant, { reservationId, customerPhone });
  return {
    reservationId: reservation.id,
    status: reservation.status,
    date: reservation.date,
    time: reservation.time,
    partySize: reservation.partySize,
    specialRequests: reservation.specialRequests,
    // Table labels only ("T5"), never raw ids — this response goes to the AI, which only ever
    // needs to say "you're at table 5" out loud, not an internal identifier.
    tables: reservation.tables?.map((t) => t.label).filter(Boolean),
  };
});

const modifyReservation = tool('modify_reservation', async (req) => {
  const { reservationId, date, time, partySize } = req.body;
  const reservation = await reservationService.modifyReservation(req.restaurant, reservationId, { date, time, partySize });
  return { reservationId: reservation.id, status: reservation.status, date: reservation.date, time: reservation.time, partySize: reservation.partySize };
});

const cancelReservation = tool('cancel_reservation', async (req) => {
  const reservation = await reservationService.cancelReservation(req.restaurant, req.body.reservationId);
  return { reservationId: reservation.id, status: reservation.status };
});

const createOrder = tool('create_order', async (req) => {
  const { customerPhone, items, reservationId, idempotencyKey } = req.body;
  const order = await orderService.createOrder(req.restaurant, { customerPhone, items, reservationId, idempotencyKey });
  return { orderId: order.id, items: order.items, subtotalCents: order.subtotalCents, totalCents: order.totalCents, status: order.status };
});

const modifyOrder = tool('modify_order', async (req) => {
  const { orderId, items } = req.body;
  const order = await orderService.modifyOrder(req.restaurant, orderId, items);
  return { orderId: order.id, items: order.items, subtotalCents: order.subtotalCents, totalCents: order.totalCents, status: order.status };
});

const cancelOrder = tool('cancel_order', async (req) => {
  const order = await orderService.cancelOrder(req.restaurant, req.body.orderId);
  return { orderId: order.id, status: order.status };
});

const transferToHuman = tool('transfer_to_human', async (req) => {
  await auditLogRepository.record({
    restaurantId: req.restaurant.id,
    actorType: 'ai',
    actorId: req.actor.sessionId,
    action: 'transfer_to_human',
    resourceType: 'conversation_session',
    resourceId: req.actor.sessionId,
    metadata: { reason: req.body.reason },
  });
  return { transferred: true };
});

module.exports = {
  getRestaurantInfo,
  getMenu,
  checkItemAvailability,
  checkTableAvailability,
  findAlternativeTimes,
  createReservation,
  getReservation,
  modifyReservation,
  cancelReservation,
  createOrder,
  modifyOrder,
  cancelOrder,
  transferToHuman,
};
