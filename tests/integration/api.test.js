/**
 * HTTP-layer integration tests via Supertest, against the real Express `app` (no listening port
 * needed) and the real Postgres test database. Service-level behavior (pricing, allocation,
 * concurrency) is already covered in reservationEngine/orderEngine tests — these focus on what's
 * specific to the HTTP layer: status codes, the error envelope, routing, auth/authorization, and
 * request parsing.
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
// Must stay within the phone validator's max length (20 chars) — timestamp + random is already
// unique enough within a single (--runInBand, sequential) test run; `tag` is just for readability
// when a test fails, truncated so it can never push the total over the limit.
const uniquePhone = (tag = '') =>
  `+977${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 90 + 10)}${tag.slice(0, 2)}`;

let restaurant;
let momo;
let staffToken;

beforeAll(async () => {
  restaurant = await restaurantRepository.findBySlug('himalayan-bites');
  const items = await menuRepository.listItems(restaurant.id);
  momo = items.find((i) => i.name.startsWith('Chicken Momo'));

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'owner@himalayanbites.test', password: 'ChangeMe123!' });
  staffToken = login.body.token;
});

afterAll(async () => {
  await pool.end();
});

const auth = (req) => req.set('Authorization', `Bearer ${staffToken}`);

describe('GET /health', () => {
  test('returns 200 with a success envelope', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: 'ok' });
  });
});

describe('POST /auth/login', () => {
  test('succeeds with the right credentials and returns a usable token', () => {
    expect(staffToken).toEqual(expect.any(String));
  });

  test('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@himalayanbites.test', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('rejects an unknown email with the same 401 (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@himalayanbites.test', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('rejects a malformed email with 400', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('restaurant/menu/tables routes (public)', () => {
  test('GET /restaurants/:id returns restaurant info with no auth required', async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurant.id}`);
    expect(res.status).toBe(200);
    expect(res.body.restaurant.name).toBe('Himalayan Bites');
  });

  test('a malformed restaurant id is a clean 400, not a raw DB error', async () => {
    const res = await request(app).get('/api/v1/restaurants/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('GET /restaurants/:id for an unknown (but valid) id returns a 404 envelope', async () => {
    const res = await request(app).get('/api/v1/restaurants/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  test('GET /restaurants/:id/menu returns categories with items', async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurant.id}/menu`);
    expect(res.status).toBe(200);
    const allItems = res.body.categories.flatMap((c) => c.items);
    expect(allItems.some((i) => i.name.startsWith('Chicken Momo'))).toBe(true);
  });

  test('GET /restaurants/:id/tables returns the seeded tables', async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurant.id}/tables`);
    expect(res.status).toBe(200);
    expect(res.body.tables).toHaveLength(6);
  });
});

describe('reservation/order routes require authentication', () => {
  test('creating a reservation with no Authorization header is rejected with 401', async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/reservations`)
      .set('Idempotency-Key', `noauth-${Date.now()}`)
      .send({ customer: { phone: uniquePhone('noauth') }, date: dayOffset(RUN_BASE_DATE, 0), time: '19:00', partySize: 2 });
    expect(res.status).toBe(401);
  });

  test('a garbage bearer token is rejected with 401', async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/reservations/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  test('a valid staff token for a DIFFERENT restaurant id is rejected with 404 (tenant isolation)', async () => {
    const res = await auth(
      request(app).get(`/api/v1/restaurants/00000000-0000-0000-0000-000000000000/reservations/00000000-0000-0000-0000-000000000000`)
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /restaurants/:id/reservations', () => {
  test('requires an Idempotency-Key header', async () => {
    const res = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/reservations`)).send({
      customer: { phone: uniquePhone('x') },
      date: dayOffset(RUN_BASE_DATE, 0),
      time: '19:00',
      partySize: 2,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('creates a CONFIRMED reservation with a valid request', async () => {
    const res = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/reservations`))
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
    const res = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/reservations`))
      .set('Idempotency-Key', `http-missing-${Date.now()}`)
      .send({ date: dayOffset(RUN_BASE_DATE, 0) });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid date format', async () => {
    const res = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/reservations`))
      .set('Idempotency-Key', `http-baddate-${Date.now()}`)
      .send({ customer: { phone: uniquePhone('baddate') }, date: '10/05/2026', time: '19:00', partySize: 2 });
    expect(res.status).toBe(400);
  });

  test('ignores a client-supplied status/restaurantId (mass assignment)', async () => {
    const res = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/reservations`))
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
    const res = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/reservations`))
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
    const res = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/reservations`))
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
    const createRes = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/reservations`))
      .set('Idempotency-Key', `http-tenant-${Date.now()}`)
      .send({
        customer: { phone: uniquePhone('tenant'), name: 'Tenant Test' },
        date: dayOffset(RUN_BASE_DATE, 1),
        time: '19:00',
        partySize: 2,
      });
    const reservationId = createRes.body.reservation.id;

    const sameRestaurant = await auth(
      request(app).get(`/api/v1/restaurants/${restaurant.id}/reservations/${reservationId}`)
    );
    expect(sameRestaurant.status).toBe(200);

    const malformedId = await auth(request(app).get(`/api/v1/restaurants/${restaurant.id}/reservations/not-a-uuid`));
    expect(malformedId.status).toBe(400);
  });
});

describe('POST /restaurants/:id/orders', () => {
  test('requires authentication', async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders`)
      .set('Idempotency-Key', `order-noauth-${Date.now()}`)
      .send({ customer: { phone: uniquePhone('order-noauth') }, items: [{ menuItemId: momo.id, quantity: 1 }] });
    expect(res.status).toBe(401);
  });

  test('prices from the database and rejects a malformed items array', async () => {
    const malformed = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/orders`))
      .set('Idempotency-Key', `http-order-bad-${Date.now()}`)
      .send({ customer: { phone: uniquePhone('order-bad') }, items: 'not-an-array' });
    expect(malformed.status).toBe(400);

    const valid = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/orders`))
      .set('Idempotency-Key', `http-order-ok-${Date.now()}`)
      .send({
        customer: { phone: uniquePhone('order-ok'), name: 'Order HTTP' },
        items: [{ menuItemId: momo.id, quantity: 2 }],
      });
    expect(valid.status).toBe(201);
    expect(valid.body.order.totalCents).toBe(momo.priceCents * 2);
  });

  test('rejects a malformed menuItemId instead of a raw DB error', async () => {
    const res = await auth(request(app).post(`/api/v1/restaurants/${restaurant.id}/orders`))
      .set('Idempotency-Key', `http-order-badid-${Date.now()}`)
      .send({ customer: { phone: uniquePhone('order-badid') }, items: [{ menuItemId: '../../etc/passwd', quantity: 1 }] });
    expect(res.status).toBe(400);
  });
});

describe('session routes', () => {
  test('create is public, but acting on the session requires the issued aiToken', async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions`)
      .send({ customerPhone: uniquePhone('session') });
    expect(created.status).toBe(201);
    const { id: sessionId } = created.body.session;
    const { aiToken } = created.body;
    expect(aiToken).toEqual(expect.any(String));

    const noAuth = await request(app).get(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}`);
    expect(noAuth.status).toBe(401);

    const withToken = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${aiToken}`);
    expect(withToken.status).toBe(200);

    const patched = await request(app)
      .patch(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${aiToken}`)
      .send({ state: { intent: 'reservation', partySize: 4 } });
    expect(patched.status).toBe(200);
    expect(patched.body.session.state).toMatchObject({ intent: 'reservation', partySize: 4 });

    const messaged = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${aiToken}`)
      .send({ role: 'customer', content: 'Table for 4 tomorrow' });
    expect(messaged.status).toBe(201);

    const transcript = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}/messages`)
      .set('Authorization', `Bearer ${aiToken}`);
    expect(transcript.status).toBe(200);
    expect(transcript.body.messages).toEqual([
      expect.objectContaining({ role: 'customer', content: 'Table for 4 tomorrow' }),
    ]);

    const ended = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${aiToken}`)
      .send({});
    expect(ended.status).toBe(200);
    expect(ended.body.session.status).toBe('COMPLETED');
  });

  test('end defaults to COMPLETED but accepts an explicit ABANDONED status', async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions`)
      .send({ customerPhone: uniquePhone('abandon') });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions/${created.body.session.id}/end`)
      .set('Authorization', `Bearer ${created.body.aiToken}`)
      .send({ status: 'ABANDONED' });
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('ABANDONED');
  });

  test("GET .../ai-actions returns this session's tool-call trace", async () => {
    const created = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions`)
      .send({ customerPhone: uniquePhone('trace') });
    const { aiToken } = created.body;
    const sessionId = created.body.session.id;

    await request(app)
      .post('/api/v1/ai/tools/get-restaurant-info')
      .set('Authorization', `Bearer ${aiToken}`)
      .send({});

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionId}/ai-actions`)
      .set('Authorization', `Bearer ${aiToken}`);
    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual([
      expect.objectContaining({ toolName: 'get_restaurant_info', status: 'SUCCESS' }),
    ]);
  });

  test("one session's aiToken cannot read a DIFFERENT session's data, even for the same restaurant", async () => {
    const sessionA = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions`)
      .send({ customerPhone: uniquePhone('sessA') });
    const sessionB = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/sessions`)
      .send({ customerPhone: uniquePhone('sessB') });

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/sessions/${sessionB.body.session.id}`)
      .set('Authorization', `Bearer ${sessionA.body.aiToken}`);
    expect(res.status).toBe(404);
  });
});

describe('unmatched routes', () => {
  test('return a 404 through the standard error envelope', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('rate limiting', () => {
  // Placed last in this file deliberately: earlier tests in this file already made several
  // /auth/login calls (shared in-memory limiter state, same as a real single-instance
  // deployment — see docs/SECURITY.md), so this just needs to push the count over the limit
  // rather than assume an exact number of remaining requests.
  test('POST /auth/login eventually responds 429 under rapid repeated requests', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/api/v1/auth/login').send({ email: 'owner@himalayanbites.test', password: 'wrong' })
      )
    );
    const limited = attempts.filter((res) => res.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0].body).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
  });
});
