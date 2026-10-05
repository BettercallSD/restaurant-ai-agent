/**
 * HTTP-layer integration tests via Supertest, against the real Express `app` (no listening port
 * needed) and the real Postgres test database. Service-level behavior (pricing, allocation,
 * concurrency) is already covered in reservationEngine/orderEngine tests — these focus on what's
 * specific to the HTTP layer: status codes, the error envelope, routing, and request parsing.
 */
const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/db/pool');
const restaurantRepository = require('../../src/repositories/restaurantRepository');
const menuRepository = require('../../src/repositories/menuRepository');

function dayOffset(baseDate, days) {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const RUN_BASE_DATE = dayOffset('2033-01-01', Math.floor(Math.random() * 3000));
const uniquePhone = (tag) => `+9779${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15) + tag;

let restaurant;
let momo;

beforeAll(async () => {
  restaurant = await restaurantRepository.findBySlug('himalayan-bites');
  const items = await menuRepository.listItems(restaurant.id);
  momo = items.find((i) => i.name.startsWith('Chicken Momo'));
});

afterAll(async () => {
  await pool.end();
});

describe('GET /health', () => {
  test('returns 200 with a success envelope', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: 'ok' });
  });
});

describe('restaurant/menu/tables routes', () => {
  test('GET /restaurants/:id returns restaurant info', async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurant.id}`);
    expect(res.status).toBe(200);
    expect(res.body.restaurant.name).toBe('Himalayan Bites');
  });

  test('GET /restaurants/:id for an unknown id returns a 404 envelope', async () => {
    const res = await request(app).get('/api/v1/restaurants/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  test('GET /restaurants/:id/menu returns categories with items', async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurant.id}/menu`);
    expect(res.status).toBe(200);
    expect(res.body.categories.length).toBeGreaterThan(0);
    const allItems = res.body.categories.flatMap((c) => c.items);
    expect(allItems.some((i) => i.name.startsWith('Chicken Momo'))).toBe(true);
  });

  test('GET /restaurants/:id/tables returns the seeded tables', async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurant.id}/tables`);
    expect(res.status).toBe(200);
    expect(res.body.tables).toHaveLength(6);
  });
});

describe('POST /restaurants/:id/reservations', () => {
  test('requires an Idempotency-Key header', async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/reservations`)
      .send({ customer: { phone: uniquePhone('x') }, date: dayOffset(RUN_BASE_DATE, 0), time: '19:00', partySize: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('creates a CONFIRMED reservation with a valid request', async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/reservations`)
      .set('Idempotency-Key', `http-${Date.now()}-${Math.random()}`)
      .send({
        customer: { phone: uniquePhone('y'), name: 'HTTP Test' },
        date: dayOffset(RUN_BASE_DATE, 0),
        time: '19:00',
        partySize: 2,
      });
    expect(res.status).toBe(201);
    expect(res.body.reservation.status).toBe('CONFIRMED');
  });

  test('rejects a request missing required fields', async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/reservations`)
      .set('Idempotency-Key', `http-missing-${Date.now()}`)
      .send({ date: dayOffset(RUN_BASE_DATE, 0) });
    expect(res.status).toBe(400);
  });

  test('ignores a client-supplied status/restaurantId (mass assignment)', async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/reservations`)
      .set('Idempotency-Key', `http-mass-${Date.now()}`)
      .send({
        customer: { phone: uniquePhone('mass'), name: 'Mass Assignment' },
        date: dayOffset(RUN_BASE_DATE, 0),
        time: '13:00',
        partySize: 2,
        status: 'COMPLETED',
        restaurantId: '00000000-0000-0000-0000-000000000000',
      });
    expect(res.status).toBe(201);
    expect(res.body.reservation.status).toBe('CONFIRMED');
  });

  test('a SQL-injection-style payload in a text field is stored as literal data, not executed', async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/reservations`)
      .set('Idempotency-Key', `http-sqli-${Date.now()}`)
      .send({
        customer: { phone: uniquePhone('sqli'), name: "Robert'); DROP TABLE reservations;--" },
        date: dayOffset(RUN_BASE_DATE, 0),
        time: '14:00',
        partySize: 2,
      });
    expect(res.status).toBe(201);
    // If the injection had worked, every later test using `reservations` would now fail outright.
  });

  test('an XSS payload in specialRequests is returned verbatim as a JSON string', async () => {
    const payload = '<script>alert(1)</script>';
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/reservations`)
      .set('Idempotency-Key', `http-xss-${Date.now()}`)
      .send({
        customer: { phone: uniquePhone('xss'), name: 'XSS Test' },
        date: dayOffset(RUN_BASE_DATE, 0),
        time: '15:00',
        partySize: 2,
        specialRequests: payload,
      });
    expect(res.status).toBe(201);
    expect(res.body.reservation.specialRequests).toBe(payload);
  });
});

describe('GET /restaurants/:id/reservations/:reservationId', () => {
  test('a reservation does not resolve under a different restaurant id (tenant isolation)', async () => {
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/reservations`)
      .set('Idempotency-Key', `http-tenant-${Date.now()}`)
      .send({
        customer: { phone: uniquePhone('tenant'), name: 'Tenant Test' },
        date: dayOffset(RUN_BASE_DATE, 1),
        time: '19:00',
        partySize: 2,
      });
    const reservationId = createRes.body.reservation.id;

    const sameRestaurant = await request(app).get(
      `/api/v1/restaurants/${restaurant.id}/reservations/${reservationId}`
    );
    expect(sameRestaurant.status).toBe(200);

    const otherRestaurant = await request(app).get(
      `/api/v1/restaurants/00000000-0000-0000-0000-000000000000/reservations/${reservationId}`
    );
    expect(otherRestaurant.status).toBe(404);
  });
});

describe('POST /restaurants/:id/orders', () => {
  test('prices from the database and rejects a malformed items array', async () => {
    const malformed = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders`)
      .set('Idempotency-Key', `http-order-bad-${Date.now()}`)
      .send({ customer: { phone: uniquePhone('order-bad') }, items: 'not-an-array' });
    expect(malformed.status).toBe(400);

    const valid = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders`)
      .set('Idempotency-Key', `http-order-ok-${Date.now()}`)
      .send({
        customer: { phone: uniquePhone('order-ok'), name: 'Order HTTP' },
        items: [{ menuItemId: momo.id, quantity: 2 }],
      });
    expect(valid.status).toBe(201);
    expect(valid.body.order.totalCents).toBe(momo.priceCents * 2);
  });
});

describe('session routes', () => {
  test('create, patch state, and append a message', async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions`)
      .send({ customerPhone: uniquePhone('session') });
    expect(created.status).toBe(201);
    const sessionId = created.body.session.id;

    const patched = await request(app)
      .patch(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}`)
      .send({ state: { intent: 'reservation', partySize: 4 } });
    expect(patched.status).toBe(200);
    expect(patched.body.session.state).toMatchObject({ intent: 'reservation', partySize: 4 });

    const messaged = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}/messages`)
      .send({ role: 'customer', content: 'Table for 4 tomorrow' });
    expect(messaged.status).toBe(201);
  });
});

describe('unmatched routes', () => {
  test('return a 404 through the standard error envelope', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});
