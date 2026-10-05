const { pool } = require('../../src/db/pool');
const restaurantRepository = require('../../src/repositories/restaurantRepository');
const menuRepository = require('../../src/repositories/menuRepository');
const reservationService = require('../../src/services/reservationService');
const orderService = require('../../src/services/orderService');

function dayOffset(baseDate, days) {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const RUN_BASE_DATE = dayOffset('2032-01-01', Math.floor(Math.random() * 3000));
const uniquePhone = (tag) => `+9779${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15) + tag;

let restaurant;
let momo;
let unavailableItem;

beforeAll(async () => {
  restaurant = await restaurantRepository.findBySlug('himalayan-bites');
  const items = await menuRepository.listItems(restaurant.id);
  momo = items.find((i) => i.name.startsWith('Chicken Momo'));
  unavailableItem = items.find((i) => !i.isAvailable);
  if (!momo || !unavailableItem) {
    throw new Error('Seed data missing expected menu items — run `npm run seed:test`.');
  }
});

afterAll(async () => {
  await pool.end();
});

describe('createOrder', () => {
  test('prices an order from the database, ignoring any caller-supplied price', async () => {
    const order = await orderService.createOrder(restaurant, {
      customerPhone: uniquePhone('order-a'),
      customerName: 'Order Test',
      items: [{ menuItemId: momo.id, quantity: 2, priceCents: 1 }], // smuggled price, must be ignored
      idempotencyKey: `it-order-basic-${Date.now()}-${Math.random()}`,
    });
    expect(order.status).toBe('PENDING');
    expect(order.items).toHaveLength(1);
    expect(order.items[0].unitPriceCents).toBe(momo.priceCents);
    expect(order.totalCents).toBe(momo.priceCents * 2);
  });

  test('replaying the same idempotency key with the same items returns the same order', async () => {
    const key = `it-order-idem-${Date.now()}-${Math.random()}`;
    const payload = {
      customerPhone: uniquePhone('order-b'),
      customerName: 'Idempotent Orderer',
      items: [{ menuItemId: momo.id, quantity: 1 }],
      idempotencyKey: key,
    };
    const first = await orderService.createOrder(restaurant, payload);
    const second = await orderService.createOrder(restaurant, payload);
    expect(second.id).toBe(first.id);
  });

  test('reusing an idempotency key with different items is rejected', async () => {
    const key = `it-order-idem-mismatch-${Date.now()}-${Math.random()}`;
    const phone = uniquePhone('order-c');
    await orderService.createOrder(restaurant, {
      customerPhone: phone,
      customerName: 'Mismatch Orderer',
      items: [{ menuItemId: momo.id, quantity: 1 }],
      idempotencyKey: key,
    });
    await expect(
      orderService.createOrder(restaurant, {
        customerPhone: phone,
        customerName: 'Mismatch Orderer',
        items: [{ menuItemId: momo.id, quantity: 2 }],
        idempotencyKey: key,
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY' });
  });

  test('two concurrent requests with the SAME idempotency key both succeed with the same order, not a duplicate or a raw DB error', async () => {
    const key = `it-order-race-${Date.now()}`;
    const payload = {
      customerPhone: uniquePhone('order-race'),
      customerName: 'Idempotency Race',
      items: [{ menuItemId: momo.id, quantity: 1 }],
      idempotencyKey: key,
    };

    const results = await Promise.allSettled([
      orderService.createOrder(restaurant, payload),
      orderService.createOrder(restaurant, payload),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(results[0].value.id).toBe(results[1].value.id);

    const { rows } = await pool.query(`SELECT count(*) FROM orders WHERE idempotency_key = $1`, [key]);
    expect(Number(rows[0].count)).toBe(1);
  });

  test('rejects an unavailable menu item', async () => {
    await expect(
      orderService.createOrder(restaurant, {
        customerPhone: uniquePhone('order-d'),
        customerName: 'Unavailable Item',
        items: [{ menuItemId: unavailableItem.id, quantity: 1 }],
        idempotencyKey: `it-order-unavail-${Date.now()}`,
      })
    ).rejects.toMatchObject({ code: 'MENU_ITEM_UNAVAILABLE' });
  });

  test('rejects a negative quantity', async () => {
    await expect(
      orderService.createOrder(restaurant, {
        customerPhone: uniquePhone('order-e'),
        customerName: 'Negative Quantity',
        items: [{ menuItemId: momo.id, quantity: -3 }],
        idempotencyKey: `it-order-negqty-${Date.now()}`,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('rejects an unknown menu item id', async () => {
    await expect(
      orderService.createOrder(restaurant, {
        customerPhone: uniquePhone('order-f'),
        customerName: 'Unknown Item',
        items: [{ menuItemId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
        idempotencyKey: `it-order-unknown-${Date.now()}`,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('links to a reservation when reservationId is provided', async () => {
    const reservation = await reservationService.createReservation(restaurant, {
      customerPhone: uniquePhone('order-link'),
      customerName: 'Linked Reservation',
      date: dayOffset(RUN_BASE_DATE, 0),
      time: '19:00',
      partySize: 2,
      idempotencyKey: `it-order-link-resv-${Date.now()}`,
    });
    const order = await orderService.createOrder(restaurant, {
      customerPhone: uniquePhone('order-link2'),
      customerName: 'Linked Reservation',
      items: [{ menuItemId: momo.id, quantity: 1 }],
      reservationId: reservation.id,
      idempotencyKey: `it-order-link-${Date.now()}`,
    });
    expect(order.reservationId).toBe(reservation.id);
  });

  test('rejects a reservationId that does not belong to this restaurant', async () => {
    await expect(
      orderService.createOrder(restaurant, {
        customerPhone: uniquePhone('order-badresv'),
        customerName: 'Bad Reservation Link',
        items: [{ menuItemId: momo.id, quantity: 1 }],
        reservationId: '00000000-0000-0000-0000-000000000000',
        idempotencyKey: `it-order-badresv-${Date.now()}`,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('modifyOrder / cancelOrder', () => {
  let order;

  beforeEach(async () => {
    order = await orderService.createOrder(restaurant, {
      customerPhone: uniquePhone('order-mod'),
      customerName: 'Modify Me',
      items: [{ menuItemId: momo.id, quantity: 1 }],
      idempotencyKey: `it-order-mod-setup-${Date.now()}-${Math.random()}`,
    });
  });

  test('modifies line items and recomputes totals from the database', async () => {
    const updated = await orderService.modifyOrder(restaurant, order.id, [{ menuItemId: momo.id, quantity: 3 }]);
    expect(updated.items).toHaveLength(1);
    expect(updated.totalCents).toBe(momo.priceCents * 3);
  });

  test('cancelling is idempotent', async () => {
    const first = await orderService.cancelOrder(restaurant, order.id);
    const second = await orderService.cancelOrder(restaurant, order.id);
    expect(first.status).toBe('CANCELLED');
    expect(second.status).toBe('CANCELLED');
  });

  test('modifying a cancelled order is rejected', async () => {
    await orderService.cancelOrder(restaurant, order.id);
    await expect(
      orderService.modifyOrder(restaurant, order.id, [{ menuItemId: momo.id, quantity: 1 }])
    ).rejects.toMatchObject({ code: 'INVALID_ORDER_TRANSITION' });
  });
});

describe('tenant isolation', () => {
  test('an order id does not resolve under an unrelated restaurant id', async () => {
    const order = await orderService.createOrder(restaurant, {
      customerPhone: uniquePhone('order-tenant'),
      customerName: 'Tenant Isolation',
      items: [{ menuItemId: momo.id, quantity: 1 }],
      idempotencyKey: `it-order-tenant-${Date.now()}`,
    });
    const fakeRestaurant = { id: '00000000-0000-0000-0000-000000000000' };
    await expect(orderService.getOrder(fakeRestaurant, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
