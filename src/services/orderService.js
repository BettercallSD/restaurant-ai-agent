const { withTransaction } = require('../db/pool');
const orderRepository = require('../repositories/orderRepository');
const customerRepository = require('../repositories/customerRepository');
const reservationRepository = require('../repositories/reservationRepository');
const menuRepository = require('../repositories/menuRepository');
const { buildOrderLines } = require('./pricingService');
const { assertOrderTransition } = require('./stateTransitionService');
const { conflict, notFound } = require('../errors/AppError');

const formatOrder = (order, items) => ({
  id: order.id,
  status: order.status,
  reservationId: order.reservationId,
  items: items.map((item) => ({
    menuItemId: item.menuItemId,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    lineTotalCents: item.lineTotalCents,
  })),
  subtotalCents: order.subtotalCents,
  totalCents: order.totalCents,
});

/** Same shape for both fetch paths: items are never trusted from the request after creation. */
async function withItems(order) {
  const items = await orderRepository.findItemsByOrderId(order.id);
  return formatOrder(order, items);
}

const normalizeItemsForComparison = (items) =>
  [...items]
    .map(({ menuItemId, quantity }) => ({ menuItemId, quantity }))
    .sort((a, b) => a.menuItemId.localeCompare(b.menuItemId));

const itemsMatch = (a, b) => JSON.stringify(normalizeItemsForComparison(a)) === JSON.stringify(normalizeItemsForComparison(b));

async function priceItems(restaurant, items) {
  const menuItemIds = [...new Set(items.map((i) => i.menuItemId))];
  const menuItems = await menuRepository.findByIdsForRestaurant(menuItemIds, restaurant.id);
  const menuItemsById = new Map(menuItems.map((item) => [item.id, item]));
  return buildOrderLines(menuItemsById, items);
}

async function createOrder(restaurant, { customerPhone, customerName, items, reservationId, idempotencyKey }) {
  const existing = await orderRepository.findByIdempotencyKey(restaurant.id, idempotencyKey);
  if (existing) {
    const existingItems = await orderRepository.findItemsByOrderId(existing.id);
    if (!itemsMatch(existingItems, items)) {
      throw conflict(
        'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
        'This idempotency key was already used for a different order request.'
      );
    }
    return formatOrder(existing, existingItems);
  }

  if (reservationId) {
    const reservation = await reservationRepository.findByIdForRestaurant(reservationId, restaurant.id);
    if (!reservation) throw notFound('Reservation');
  }

  // Pricing happens before the transaction: it's a pure read (no locking needed — see
  // docs/DECISIONS.md, there's no concurrency hazard in reading a price, only in reading table
  // availability) and failing fast here avoids opening a transaction for a request that was never
  // going to succeed.
  const { lines, subtotalCents, totalCents } = await priceItems(restaurant, items);
  const customer = await customerRepository.findOrCreate(restaurant.id, customerPhone, customerName);

  const order = await withTransaction(async (client) => {
    const created = await orderRepository.insert(
      {
        restaurantId: restaurant.id,
        customerId: customer.id,
        reservationId: reservationId ?? null,
        subtotalCents,
        totalCents,
        idempotencyKey,
        status: 'PENDING',
      },
      client
    );
    await orderRepository.insertItems(created.id, lines, client);
    return created;
  });

  return formatOrder(order, lines);
}

async function getOrder(restaurant, orderId) {
  const order = await orderRepository.findByIdForRestaurant(orderId, restaurant.id);
  if (!order) throw notFound('Order');
  return withItems(order);
}

async function modifyOrder(restaurant, orderId, items) {
  const existing = await orderRepository.findByIdForRestaurant(orderId, restaurant.id);
  if (!existing) throw notFound('Order');
  if (existing.status !== 'PENDING') {
    throw conflict('INVALID_ORDER_TRANSITION', `Cannot modify an order that is already ${existing.status}.`);
  }

  const { lines, subtotalCents, totalCents } = await priceItems(restaurant, items);

  const updated = await withTransaction(async (client) => {
    await orderRepository.clearItems(existing.id, client);
    await orderRepository.insertItems(existing.id, lines, client);
    return orderRepository.updateTotals(existing.id, restaurant.id, { subtotalCents, totalCents }, client);
  });

  return formatOrder(updated, lines);
}

async function cancelOrder(restaurant, orderId) {
  const existing = await orderRepository.findByIdForRestaurant(orderId, restaurant.id);
  if (!existing) throw notFound('Order');

  // Idempotent, matching cancelReservation's behavior: cancelling an already-cancelled order
  // succeeds rather than erroring.
  if (existing.status === 'CANCELLED') {
    return withItems(existing);
  }

  assertOrderTransition(existing.status, 'CANCELLED');
  const updated = await withTransaction((client) =>
    orderRepository.updateStatus(existing.id, restaurant.id, 'CANCELLED', client)
  );
  return withItems(updated);
}

module.exports = { createOrder, getOrder, modifyOrder, cancelOrder };
