const {
  weekdayKeyForDate,
  isWithinOpeningHours,
  isInPast,
  listCandidateTimes,
  assertReservationDateTimeIsBookable,
} = require('../../src/services/openingHoursService');

const restaurant = {
  timezone: 'Asia/Kathmandu',
  openingHours: {
    sun: { open: '11:00', close: '21:30' },
    mon: { open: '11:00', close: '21:30' },
    tue: { open: '11:00', close: '21:30' },
    wed: { open: '11:00', close: '21:30' },
    thu: { open: '11:00', close: '21:30' },
    fri: { open: '11:00', close: '22:00' },
    sat: { open: '11:00', close: '22:00' },
  },
};

describe('weekdayKeyForDate', () => {
  test('resolves a known date to the correct weekday regardless of local machine timezone', () => {
    // 2026-10-05 is a Monday.
    expect(weekdayKeyForDate('2026-10-05')).toBe('mon');
    // 2026-10-10 is a Saturday.
    expect(weekdayKeyForDate('2026-10-10')).toBe('sat');
  });
});

describe('isWithinOpeningHours', () => {
  test('a time inside the day\'s hours is within opening hours', () => {
    expect(isWithinOpeningHours(restaurant, '2026-10-05', '19:00')).toBe(true);
  });

  test('a time before opening is rejected', () => {
    expect(isWithinOpeningHours(restaurant, '2026-10-05', '09:00')).toBe(false);
  });

  test('a time after closing is rejected', () => {
    expect(isWithinOpeningHours(restaurant, '2026-10-05', '23:00')).toBe(false);
  });

  test('a day with no configured hours is treated as closed', () => {
    const noSundayRestaurant = { ...restaurant, openingHours: { ...restaurant.openingHours, sun: undefined } };
    expect(isWithinOpeningHours(noSundayRestaurant, '2026-10-04', '19:00')).toBe(false);
  });
});

describe('isInPast', () => {
  test('a date far in the future is not in the past', () => {
    expect(isInPast(restaurant, '2099-01-01', '12:00')).toBe(false);
  });

  test('a date far in the past is in the past', () => {
    expect(isInPast(restaurant, '2000-01-01', '12:00')).toBe(true);
  });
});

describe('listCandidateTimes', () => {
  test('generates 30-minute slots that leave room for the full reservation duration before closing', () => {
    const slots = listCandidateTimes(restaurant, '2099-10-05', { intervalMinutes: 30, reservationDurationMinutes: 90 });
    expect(slots[0]).toBe('11:00');
    // Monday closes at 21:30; the last slot must start no later than 20:00 (21:30 - 90min).
    expect(slots[slots.length - 1]).toBe('20:00');
    expect(slots).not.toContain('20:30');
  });

  test('returns no slots on a day the restaurant has no configured hours for', () => {
    const noSundayRestaurant = { ...restaurant, openingHours: { ...restaurant.openingHours, sun: undefined } };
    expect(listCandidateTimes(noSundayRestaurant, '2099-10-04')).toEqual([]);
  });
});

describe('assertReservationDateTimeIsBookable', () => {
  test('accepts a valid future in-hours date/time', () => {
    expect(() => assertReservationDateTimeIsBookable(restaurant, '2099-10-05', '19:00')).not.toThrow();
  });

  test('rejects a past date/time', () => {
    expect(() => assertReservationDateTimeIsBookable(restaurant, '2000-01-01', '19:00')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    );
  });

  test('rejects a time outside opening hours', () => {
    expect(() => assertReservationDateTimeIsBookable(restaurant, '2099-10-05', '23:00')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    );
  });
});
