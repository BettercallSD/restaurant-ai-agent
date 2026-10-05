/**
 * All arithmetic here treats `date`/`time` as an abstract calendar timestamp (restaurant-local
 * wall clock, matching how reservation_date/reservation_time are stored — see
 * docs/DATABASE.md), not a real-world instant. Parsing/formatting through Date.UTC is just a
 * convenient way to get correct calendar math (minute overflow, day rollover) without a date
 * library; it is never used to convert between timezones.
 */

function normalizeTime(time) {
  return time.length === 5 ? `${time}:00` : time;
}

/** 'YYYY-MM-DD' + 'HH:mm[:ss]' -> 'YYYY-MM-DD HH:mm:ss', the format Postgres parses for tsrange. */
function toTimestampString(date, time) {
  return `${date} ${normalizeTime(time)}`;
}

function addMinutes(date, time, minutes) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = normalizeTime(time).split(':').map(Number);
  const instant = Date.UTC(year, month - 1, day, hour, minute, second) + minutes * 60_000;
  const result = new Date(instant);
  return {
    date: result.toISOString().slice(0, 10),
    time: result.toISOString().slice(11, 19),
  };
}

module.exports = { normalizeTime, toTimestampString, addMinutes };
