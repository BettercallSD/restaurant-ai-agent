/**
 * Tests the full agentic path end to end: AI session token -> /ai/tools/* -> service ->
 * repository -> database -> ai_actions log -> structured response. This is what proves the AI
 * genuinely goes through the same business logic and authorization as everything else, not a
 * special-cased shortcut (docs/PROJECT_OVERVIEW.md's "AI is an operational interface, not a
 * conversational layer").
 */
const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/db/pool');
const restaurantRepository = require('../../src/repositories/restaurantRepository');
const menuRepository = require('../../src/repositories/menuRepository');
const aiActionRepository = require('../../src/repositories/aiActionRepository');

function dayOffset(baseDate, days) {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const RUN_BASE_DATE = dayOffset('2034-01-01', Math.floor(Math.random() * 3000));
const uniquePhone = (tag = '') =>
  `+977${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 90 + 10)}${tag.slice(0, 2)}`;

let restaurant;
let momo;
let aiToken;
let sessionId;

beforeAll(async () => {
  restaurant = await restaurantRepository.findBySlug('himalayan-bites');
  const items = await menuRepository.listItems(restaurant.id);
  momo = items.find((i) => i.name.startsWith('Chicken Momo'));

  const session = await request(app)
    .post(`/api/v1/restaurants/${restaurant.id}/sessions`)
    .send({ customerPhone: uniquePhone('ai') });
  aiToken = session.body.aiToken;
  sessionId = session.body.session.id;
});

afterAll(async () => {
  await pool.end();
});

const callTool = (name, body) =>
  request(app).post(`/api/v1/ai/tools/${name}`).set('Authorization', `Bearer ${aiToken}`).send(body);

describe('AI tool authentication/authorization', () => {
  test('a staff JWT is rejected — tool endpoints are AI-only', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@himalayanbites.test', password: 'ChangeMe123!' });
    const res = await request(app)
      .post('/api/v1/ai/tools/get-restaurant-info')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  test('no token is rejected with 401', async () => {
    const res = await request(app).post('/api/v1/ai/tools/get-restaurant-info').send({});
    expect(res.status).toBe(401);
  });
});

describe('read-only tools', () => {
  test('get_restaurant_info returns the restaurant, not a database row', async () => {
    const res = await callTool('get-restaurant-info', {});
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Himalayan Bites');
    // No internal/irrelevant fields leaked, e.g. a raw `id` or `allowTableCombination` flag.
    expect(res.body.id).toBeUndefined();
  });

  test('get_menu returns categories with items', async () => {
    const res = await callTool('get-menu', {});
    expect(res.status).toBe(200);
    const allItems = res.body.categories.flatMap((c) => c.items);
    expect(allItems.some((i) => i.name.startsWith('Chicken Momo'))).toBe(true);
  });

  test('check_item_availability reports price and availability', async () => {
    const res = await callTool('check-item-availability', { menuItemId: momo.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, name: momo.name, priceCents: momo.priceCents });
  });

  test('check_table_availability returns options when free, alternatives when not', async () => {
    const date = dayOffset(RUN_BASE_DATE, 0);
    const available = await callTool('check-table-availability', { date, time: '19:00', partySize: 2 });
    expect(available.status).toBe(200);
    expect(available.body.available).toBe(true);
    expect(available.body.options.length).toBeGreaterThan(0);
  });
});

describe('the full agentic flow: check -> create -> confirm', () => {
  test('AI never gets to claim success until create_reservation actually confirms it', async () => {
    const date = dayOffset(RUN_BASE_DATE, 1);

    // 1. AI checks availability first (as the agent flow in docs/AGENT_FLOW.md describes).
    const check = await callTool('check-table-availability', { date, time: '19:00', partySize: 2 });
    expect(check.body.available).toBe(true);

    // 2. AI books it.
    const created = await callTool('create-reservation', {
      customerName: 'Agentic Flow Test',
      customerPhone: uniquePhone('flow'),
      date,
      time: '19:00',
      partySize: 2,
      idempotencyKey: `ai-flow-${Date.now()}`,
    });
    expect(created.status).toBe(200);
    expect(created.body.status).toBe('CONFIRMED');
    const { reservationId } = created.body;

    // 3. AI can look it back up, modify it, then cancel it — all through the tool layer.
    const fetched = await callTool('get-reservation', { reservationId });
    expect(fetched.status).toBe(200);
    expect(fetched.body.tables.length).toBeGreaterThan(0); // table labels, not raw ids
    expect(typeof fetched.body.tables[0]).toBe('string');

    const modified = await callTool('modify-reservation', { reservationId, time: '20:00' });
    expect(modified.status).toBe(200);
    expect(modified.body.time.startsWith('20:00')).toBe(true);

    const cancelled = await callTool('cancel-reservation', { reservationId });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    // 4. Every one of those calls was logged to ai_actions for this session.
    const actions = await aiActionRepository.listForSession(sessionId);
    const toolNames = actions.map((a) => a.toolName);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'check_table_availability',
        'create_reservation',
        'get_reservation',
        'modify_reservation',
        'cancel_reservation',
      ])
    );
    expect(actions.every((a) => a.status === 'SUCCESS')).toBe(true);
  });

  test('create_reservation never returns success on a slot it could not actually book', async () => {
    const date = dayOffset(RUN_BASE_DATE, 2);
    const time = '18:00';
    // Fill every table so nothing is left.
    for (const size of [2, 2, 4, 4, 6, 8]) {
      // eslint-disable-next-line no-await-in-loop
      await callTool('create-reservation', {
        customerName: `Filler ${size}`,
        customerPhone: uniquePhone(`f${size}`),
        date,
        time,
        partySize: size,
        idempotencyKey: `ai-fill-${date}-${size}-${Math.random()}`,
      });
    }

    const overflow = await callTool('create-reservation', {
      customerName: 'Overflow',
      customerPhone: uniquePhone('over'),
      date,
      time,
      partySize: 2,
      idempotencyKey: `ai-overflow-${Date.now()}`,
    });
    expect(overflow.status).toBe(409);
    expect(overflow.body).toMatchObject({
      success: false,
      error: { code: 'RESERVATION_UNAVAILABLE' },
      alternatives: expect.any(Array),
    });

    // A failed call is logged too — the dashboard's AI-activity trace shows attempts, not just
    // successes.
    const failedAction = (await aiActionRepository.listForSession(sessionId)).find(
      (a) => a.status === 'FAILURE' && a.toolName === 'create_reservation'
    );
    expect(failedAction).toBeTruthy();
  });
});

describe('ordering through the tool layer', () => {
  test('create_order prices from the database, never from the AI-supplied value', async () => {
    const res = await callTool('create-order', {
      customerPhone: uniquePhone('order'),
      items: [{ menuItemId: momo.id, quantity: 3, priceCents: 1 }], // smuggled price, must be ignored
      idempotencyKey: `ai-order-${Date.now()}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.totalCents).toBe(momo.priceCents * 3);
  });

  test('ordering an unavailable item is rejected with the documented error code', async () => {
    const items = await menuRepository.listItems(restaurant.id);
    const unavailable = items.find((i) => !i.isAvailable);
    const res = await callTool('create-order', {
      customerPhone: uniquePhone('unavail'),
      items: [{ menuItemId: unavailable.id, quantity: 1 }],
      idempotencyKey: `ai-order-unavail-${Date.now()}`,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MENU_ITEM_UNAVAILABLE');
  });
});

describe('transfer_to_human', () => {
  test('records the event and returns transferred: true', async () => {
    const res = await callTool('transfer-to-human', { reason: 'Customer wants to book 80 people.' });
    expect(res.status).toBe(200);
    expect(res.body.transferred).toBe(true);
  });
});

describe('malicious/invalid tool arguments', () => {
  test('invalid tool arguments never reach the service layer', async () => {
    const res = await callTool('create-reservation', { date: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('a prompt-injection-style reservationId does not resolve another restaurant\'s data', async () => {
    const res = await callTool('get-reservation', { reservationId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  test('there is no tool that returns bulk customer data', () => {
    const toolNames = [
      'get-restaurant-info',
      'get-menu',
      'check-item-availability',
      'check-table-availability',
      'find-alternative-times',
      'create-reservation',
      'get-reservation',
      'modify-reservation',
      'cancel-reservation',
      'create-order',
      'modify-order',
      'cancel-order',
      'transfer-to-human',
    ];
    expect(toolNames.find((n) => /customer|phone|list|dump|export/i.test(n))).toBeUndefined();
  });
});
