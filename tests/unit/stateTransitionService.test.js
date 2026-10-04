const {
  assertReservationTransition,
  assertOrderTransition,
} = require('../../src/services/stateTransitionService');

describe('reservation state transitions', () => {
  test('PENDING -> CONFIRMED is allowed', () => {
    expect(() => assertReservationTransition('PENDING', 'CONFIRMED')).not.toThrow();
  });

  test('CONFIRMED -> CANCELLED is allowed', () => {
    expect(() => assertReservationTransition('CONFIRMED', 'CANCELLED')).not.toThrow();
  });

  test('CONFIRMED -> NO_SHOW is allowed', () => {
    expect(() => assertReservationTransition('CONFIRMED', 'NO_SHOW')).not.toThrow();
  });

  test('CANCELLED -> CONFIRMED is rejected (the canonical invalid transition)', () => {
    expect(() => assertReservationTransition('CANCELLED', 'CONFIRMED')).toThrow(
      expect.objectContaining({ code: 'INVALID_RESERVATION_TRANSITION' })
    );
  });

  test('COMPLETED is terminal', () => {
    expect(() => assertReservationTransition('COMPLETED', 'CANCELLED')).toThrow();
    expect(() => assertReservationTransition('COMPLETED', 'CONFIRMED')).toThrow();
  });

  test('NO_SHOW is terminal', () => {
    expect(() => assertReservationTransition('NO_SHOW', 'CONFIRMED')).toThrow();
  });
});

describe('order state transitions', () => {
  test('PENDING -> CONFIRMED -> PREPARING -> COMPLETED is a valid chain', () => {
    expect(() => assertOrderTransition('PENDING', 'CONFIRMED')).not.toThrow();
    expect(() => assertOrderTransition('CONFIRMED', 'PREPARING')).not.toThrow();
    expect(() => assertOrderTransition('PREPARING', 'COMPLETED')).not.toThrow();
  });

  test('PREPARING cannot be cancelled', () => {
    expect(() => assertOrderTransition('PREPARING', 'CANCELLED')).toThrow(
      expect.objectContaining({ code: 'INVALID_ORDER_TRANSITION' })
    );
  });

  test('COMPLETED is terminal', () => {
    expect(() => assertOrderTransition('COMPLETED', 'CANCELLED')).toThrow();
  });
});
