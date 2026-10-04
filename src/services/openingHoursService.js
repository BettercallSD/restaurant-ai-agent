const { validationError } = require('../errors/AppError');

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * reservation_date/reservation_time are stored as the restaurant's own local wall-clock time —
 * no timezone conversion happens anywhere in the schema (see docs/DATABASE.md). That means every
 * comparison in this file works on plain 'YYYY-MM-DD'/'HH:mm[:ss]' strings, which sort correctly
 * as plain strings because they're zero-padded ISO-ish formats. The one place an actual timezone
 * matters is figuring out "what is 'now' in the restaurant's own timezone" — handled by
 * `nowInTimezone` using the platform's built-in `Intl` support, so we don't need a date library
 * dependency just to answer that.
 */
function nowInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  };
}

/** A calendar date's weekday doesn't depend on timezone — noon UTC avoids any DST edge case. */
function weekdayKeyForDate(dateStr) {
  const dayIndex = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return WEEKDAY_KEYS[dayIndex];
}

function normalizeTime(time) {
  // Accept 'HH:mm' or 'HH:mm:ss' and compare consistently by padding to 'HH:mm:ss'.
  return time.length === 5 ? `${time}:00` : time;
}

function isInPast(restaurant, date, time) {
  const now = nowInTimezone(restaurant.timezone);
  return `${date}T${normalizeTime(time)}` < `${now.date}T${now.time}`;
}

/**
 * Only handles same-day hours (open < close) — a restaurant open past midnight would need a
 * richer opening_hours shape than docs/DATABASE.md defines; out of scope for v1, noted here
 * rather than silently mishandled.
 */
function isWithinOpeningHours(restaurant, date, time) {
  const hours = restaurant.openingHours?.[weekdayKeyForDate(date)];
  if (!hours) return false;
  const t = normalizeTime(time);
  return t >= normalizeTime(hours.open) && t <= normalizeTime(hours.close);
}

/**
 * Throws a VALIDATION_ERROR AppError if the requested date/time is in the past or outside the
 * restaurant's opening hours for that weekday. Called before any table-allocation attempt — this
 * is business logic that needs restaurant-specific data (timezone, opening_hours), which is why
 * it lives in a service rather than a stateless zod schema (Phase 11's validators catch
 * malformed shapes; this catches "well-formed but doesn't make sense for this restaurant").
 */
function assertReservationDateTimeIsBookable(restaurant, date, time) {
  if (isInPast(restaurant, date, time)) {
    throw validationError('Requested date/time is in the past.');
  }
  if (!isWithinOpeningHours(restaurant, date, time)) {
    throw validationError('Requested time is outside the restaurant\'s opening hours.');
  }
}

/**
 * Candidate booking start times for a given date, stepped every `intervalMinutes`, stopping early
 * enough that a `reservationDurationMinutes`-long booking still finishes by closing time, and
 * excluding any slot already in the past if `date` is today. This is the full candidate set
 * find_alternative_times (Phase 7/8) checks table availability against — it does not itself know
 * anything about tables, only about when the restaurant could conceivably seat someone.
 */
function listCandidateTimes(restaurant, date, { intervalMinutes = 30, reservationDurationMinutes = 90 } = {}) {
  const hours = restaurant.openingHours?.[weekdayKeyForDate(date)];
  if (!hours) return [];

  const toMinutes = (hhmm) => {
    const [h, m] = normalizeTime(hhmm).split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (totalMinutes) => {
    const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const m = String(totalMinutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  };

  const openMin = toMinutes(hours.open);
  const lastStartMin = toMinutes(hours.close) - reservationDurationMinutes;

  const slots = [];
  for (let t = openMin; t <= lastStartMin; t += intervalMinutes) {
    const candidate = toHHMM(t);
    if (!isInPast(restaurant, date, candidate)) {
      slots.push(candidate);
    }
  }
  return slots;
}

module.exports = {
  nowInTimezone,
  weekdayKeyForDate,
  isInPast,
  isWithinOpeningHours,
  assertReservationDateTimeIsBookable,
  listCandidateTimes,
};
