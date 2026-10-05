/**
 * Integration tests against a real Postgres database (DATABASE_URL_TEST — see docs/TESTING.md).
 * These exercise the full service -> repository -> database path, unlike tests/unit/*.
 *
 * Every test uses a date unique to this test run (randomized far-future base date) rather than a
 * fixed hardcoded date, so re-running the suite never collides with a previous run's leftover
 * rows — this matters especially for the concurrency test below, which commits real transactions
 * and can't be wrapped in an outer rollback without defeating the point of the test.
 */
const { pool } = require('../../src/db/pool');
const restaurantRepository = require('../../src/repositories/restaurantRepository');
const reservationService = require('../../src/services/reservationService');

function dayOffset(baseDate, days) {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const RUN_BASE_DATE = dayOffset('2031-01-01', Math.floor(Math.random() * 3000));
const uniquePhone = (tag) => `+9779${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15) + tag;

let restaurant;

beforeAll(async () => {
  restaurant = await restaurantRepository.findBySlug('himalayan-bites');
  if (!restaurant) {
    throw new Error('Seed data not found — run `npm run seed:test` before the integration suite.');
  }
});

afterAll(async () => {
  await pool.end();
});

describe('createReservation', () => {
  test('creates a CONFIRMED reservation with a table assigned', async () => {
    const date = dayOffset(RUN_BASE_DATE, 0);
    const reservation = await reservationService.createReservation(restaurant, {
      customerPhone: uniquePhone('a'),
      customerName: 'Integration Test',
      date,
      time: '19:00',
      partySize: 2,
      idempotencyKey: `it-basic-${Date.now()}-${Math.random()}`,
    });
    expect(reservation.status).toBe('CONFIRMED');
    expect(reservation.tables).toHaveLength(1);
  });

  test('replaying the same idempotency key with the same body returns the same reservation', async () => {
    const date = dayOffset(RUN_BASE_DATE, 0);
    const key = `it-idem-${Date.now()}-${Math.random()}`;
    const payload = {
      customerPhone: uniquePhone('b'),
      customerName: 'Idempotency Test',
      date,
      time: '12:00',
      partySize: 2,
      idempotencyKey: key,
    };
    const first = await reservationService.createReservation(restaurant, payload);
    const second = await reservationService.createReservation(restaurant, payload);
    expect(second.id).toBe(first.id);
  });

  test('reusing an idempotency key with a different body is rejected', async () => {
    const date = dayOffset(RUN_BASE_DATE, 0);
    const key = `it-idem-mismatch-${Date.now()}-${Math.random()}`;
    const phone = uniquePhone('c');
    await reservationService.createReservation(restaurant, {
      customerPhone: phone,
      customerName: 'Idempotency Mismatch',
      date,
      time: '12:30',
      partySize: 2,
      idempotencyKey: key,
    });
    await expect(
      reservationService.createReservation(restaurant, {
        customerPhone: phone,
        customerName: 'Idempotency Mismatch',
        date,
        time: '13:00', // different time, same key
        partySize: 2,
        idempotencyKey: key,
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY' });
  });

  test('rejects an invalid party size', async () => {
    await expect(
      reservationService.createReservation(restaurant, {
        customerPhone: uniquePhone('d'),
        customerName: 'Bad Party Size',
        date: dayOffset(RUN_BASE_DATE, 0),
        time: '19:00',
        partySize: 0,
        idempotencyKey: `it-bad-size-${Date.now()}-${Math.random()}`,
      })
    ).rejects.toBeTruthy();
  });

  test('rejects a past date', async () => {
    await expect(
      reservationService.createReservation(restaurant, {
        customerPhone: uniquePhone('e'),
        customerName: 'Time Traveler',
        date: '2000-01-01',
        time: '19:00',
        partySize: 2,
        idempotencyKey: `it-past-${Date.now()}-${Math.random()}`,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('exhausting capacity returns RESERVATION_UNAVAILABLE with structured alternatives', async () => {
    const date = dayOffset(RUN_BASE_DATE, 1);
    const time = '18:00';
    // Fill every table via exact-fit bookings: 2,2,4,4,6,8 covers all 6 tables.
    for (const size of [2, 2, 4, 4, 6, 8]) {
      // eslint-disable-next-line no-await-in-loop
      await reservationService.createReservation(restaurant, {
        customerPhone: uniquePhone(`f${size}${Math.random()}`),
        customerName: `Filler ${size}`,
        date,
        time,
        partySize: size,
        idempotencyKey: `it-fill-${date}-${size}-${Math.random()}`,
      });
    }

    await expect(
      reservationService.createReservation(restaurant, {
        customerPhone: uniquePhone('g'),
        customerName: 'One Too Many',
        date,
        time,
        partySize: 2,
        idempotencyKey: `it-overflow-${Date.now()}`,
      })
    ).rejects.toMatchObject({
      code: 'RESERVATION_UNAVAILABLE',
      details: { alternatives: expect.any(Array) },
    });
  });

  test('two genuinely concurrent requests for the last remaining table: exactly one succeeds', async () => {
    const date = dayOffset(RUN_BASE_DATE, 2);
    const time = '20:00';
    // Fill every table except the 8-top via exact-fit bookings, done sequentially so the setup
    // itself isn't racing anything - only the final two requests below are concurrent.
    for (const size of [2, 2, 4, 4, 6]) {
      // eslint-disable-next-line no-await-in-loop
      await reservationService.createReservation(restaurant, {
        customerPhone: uniquePhone(`h${size}${Math.random()}`),
        customerName: `Prefill ${size}`,
        date,
        time,
        partySize: size,
        idempotencyKey: `it-prefill-${date}-${size}-${Math.random()}`,
      });
    }

    const results = await Promise.allSettled([
      reservationService.createReservation(restaurant, {
        customerPhone: uniquePhone('racerA'),
        customerName: 'Racer A',
        date,
        time,
        partySize: 8,
        idempotencyKey: `it-race-a-${Date.now()}`,
      }),
      reservationService.createReservation(restaurant, {
        customerPhone: uniquePhone('racerB'),
        customerName: 'Racer B',
        date,
        time,
        partySize: 8,
        idempotencyKey: `it-race-b-${Date.now()}`,
      }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.code).toBe('RESERVATION_UNAVAILABLE');
  });

  test('two concurrent requests with the SAME idempotency key both succeed with the same reservation, not a duplicate or a raw DB error', async () => {
    const date = dayOffset(RUN_BASE_DATE, 3);
    const key = `it-race-same-key-${Date.now()}`;
    const payload = {
      customerPhone: uniquePhone('samekey'),
      customerName: 'Idempotency Race',
      date,
      time: '19:00',
      partySize: 2,
      idempotencyKey: key,
    };

    const results = await Promise.allSettled([
      reservationService.createReservation(restaurant, payload),
      reservationService.createReservation(restaurant, payload),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(results[0].value.id).toBe(results[1].value.id);

    const { rows } = await pool.query(`SELECT count(*) FROM reservations WHERE idempotency_key = $1`, [key]);
    expect(Number(rows[0].count)).toBe(1);
  });
});

describe('modifyReservation / cancelReservation', () => {
  let reservation;

  beforeAll(async () => {
    reservation = await reservationService.createReservation(restaurant, {
      customerPhone: uniquePhone('mod'),
      customerName: 'Modify Me',
      date: dayOffset(RUN_BASE_DATE, 3),
      time: '19:00',
      partySize: 2,
      idempotencyKey: `it-mod-setup-${Date.now()}`,
    });
  });

  test('modifies the reservation time and re-allocates a table', async () => {
    const updated = await reservationService.modifyReservation(restaurant, reservation.id, { time: '20:00' });
    expect(updated.time.slice(0, 5)).toBe('20:00');
  });

  test('cancelling is idempotent', async () => {
    const first = await reservationService.cancelReservation(restaurant, reservation.id);
    const second = await reservationService.cancelReservation(restaurant, reservation.id);
    expect(first.status).toBe('CANCELLED');
    expect(second.status).toBe('CANCELLED');
  });

  test('modifying a cancelled reservation is rejected', async () => {
    await expect(
      reservationService.modifyReservation(restaurant, reservation.id, { time: '21:00' })
    ).rejects.toMatchObject({ code: 'INVALID_RESERVATION_TRANSITION' });
  });
});

describe('tenant isolation', () => {
  test('a reservation id does not resolve under an unrelated restaurant id', async () => {
    const reservation = await reservationService.createReservation(restaurant, {
      customerPhone: uniquePhone('tenant'),
      customerName: 'Tenant Isolation',
      date: dayOffset(RUN_BASE_DATE, 4),
      time: '19:00',
      partySize: 2,
      idempotencyKey: `it-tenant-${Date.now()}`,
    });
    const fakeRestaurant = { id: '00000000-0000-0000-0000-000000000000' };
    await expect(
      reservationService.getReservation(fakeRestaurant, { reservationId: reservation.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
