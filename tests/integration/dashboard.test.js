/**
 * Dashboard list endpoints (staff-only) and AI-token revocation when a call ends.
 */
const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/app');
const { pool } = require('../../src/db/pool');
const restaurantRepository = require('../../src/repositories/restaurantRepository');
const menuRepository = require('../../src/repositories/menuRepository');

function dayOffset(baseDate, days) {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const RUN_DATE = dayOffset('2034-01-01', Math.floor(Math.random() * 3000));
const uniquePhone = () => `+977${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 90 + 10)}`;

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

const base = () => `/api/v1/restaurants/${restaurant.id}`;
const staff = (req) => req.set('Authorization', `Bearer ${staffToken}`);

async function newAiSession() {
  const res = await request(app).post(`${base()}/sessions`).send({ customerPhone: uniquePhone() });
  return { sessionId: res.body.session.id, aiToken: res.body.aiToken };
}

describe('GET /restaurants/:id/reservations (dashboard list)', () => {
  test('staff see reservations for a date with customer details and table labels', async () => {
    const phone = uniquePhone();
    const created = await staff(request(app).post(`${base()}/reservations`))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customer: { name: 'Sharma', phone }, date: RUN_DATE, time: '19:00', partySize: 4 });
    expect(created.status).toBe(201);

    const res = await staff(request(app).get(`${base()}/reservations`)).query({ date: RUN_DATE });
    expect(res.status).toBe(200);
    const row = res.body.reservations.find((r) => r.id === created.body.reservation.id);
    expect(row).toMatchObject({
      date: RUN_DATE,
      partySize: 4,
      status: 'CONFIRMED',
      customer: { name: 'Sharma', phone },
    });
    expect(row.tables.length).toBeGreaterThan(0);
    expect(res.body.reservations.every((r) => r.date === RUN_DATE)).toBe(true);
  });

  test('an AI session token is refused (403), so one call cannot list every customer', async () => {
    const { aiToken } = await newAiSession();
    const res = await request(app).get(`${base()}/reservations`).set('Authorization', `Bearer ${aiToken}`);
    expect(res.status).toBe(403);
  });

  test('requires authentication and validates the date filter', async () => {
    expect((await request(app).get(`${base()}/reservations`)).status).toBe(401);
    const bad = await staff(request(app).get(`${base()}/reservations`)).query({ date: 'tomorrow' });
    expect(bad.status).toBe(400);
  });
});

describe('GET /restaurants/:id/orders (dashboard list)', () => {
  test('staff see orders with item names and server-computed totals', async () => {
    const created = await staff(request(app).post(`${base()}/orders`))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customer: { name: 'Thapa', phone: uniquePhone() }, items: [{ menuItemId: momo.id, quantity: 2 }] });
    expect(created.status).toBe(201);

    const res = await staff(request(app).get(`${base()}/orders`));
    expect(res.status).toBe(200);
    const row = res.body.orders.find((o) => o.id === created.body.order.id);
    expect(row.customer.name).toBe('Thapa');
    expect(row.items).toEqual([expect.objectContaining({ name: momo.name, quantity: 2 })]);
    expect(row.totalCents).toBe(momo.priceCents * 2);
  });

  test('an AI session token is refused (403)', async () => {
    const { aiToken } = await newAiSession();
    const res = await request(app).get(`${base()}/orders`).set('Authorization', `Bearer ${aiToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /restaurants/:id/sessions (calls list)', () => {
  test('staff see recent calls with their tool-call counts', async () => {
    const { sessionId, aiToken } = await newAiSession();
    await request(app).post('/api/v1/ai/tools/get-restaurant-info').set('Authorization', `Bearer ${aiToken}`).send({});

    const res = await staff(request(app).get(`${base()}/sessions`));
    expect(res.status).toBe(200);
    const row = res.body.sessions.find((s) => s.id === sessionId);
    expect(row).toMatchObject({ status: 'ACTIVE', actionCount: 1 });
  });

  test('an AI session token is refused (403)', async () => {
    const { aiToken } = await newAiSession();
    const res = await request(app).get(`${base()}/sessions`).set('Authorization', `Bearer ${aiToken}`);
    expect(res.status).toBe(403);
  });
});

describe('ending a call revokes its aiToken', () => {
  test('tool calls and session reads are rejected (401) once the session is ended', async () => {
    const { sessionId, aiToken } = await newAiSession();
    const bearer = `Bearer ${aiToken}`;

    const before = await request(app).post('/api/v1/ai/tools/get-restaurant-info').set('Authorization', bearer).send({});
    expect(before.status).toBe(200);

    const end = await request(app).post(`${base()}/sessions/${sessionId}/end`).set('Authorization', bearer).send({});
    expect(end.status).toBe(200);

    const tool = await request(app).post('/api/v1/ai/tools/get-restaurant-info').set('Authorization', bearer).send({});
    expect(tool.status).toBe(401);
    const read = await request(app).get(`${base()}/sessions/${sessionId}`).set('Authorization', bearer);
    expect(read.status).toBe(401);

    // Staff can still see the finished call on the dashboard.
    const staffRead = await staff(request(app).get(`${base()}/sessions/${sessionId}`));
    expect(staffRead.body.session.status).toBe('COMPLETED');
  });
});
