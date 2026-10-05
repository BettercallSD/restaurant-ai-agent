const { pool } = require('../db/pool');
const tableRepository = require('../repositories/tableRepository');
const reservationRepository = require('../repositories/reservationRepository');
const { MAX_COMBINED_TABLES } = require('../config/constants');

/**
 * Given party size 5 and tables T1=2, T2=4, T3=6, the allocation preference is:
 *   1. exact fit        - a table whose capacity equals the party size exactly (none here)
 *   2. smallest suitable - the smallest table that still fits everyone (T3=6, wastes 1 seat)
 *   3. allowed combination - only if the restaurant allows it, and only when no single table fits
 *      (e.g. party of 10 with tables maxing out at 8: combine T2=4 + T_8=8? no - combine the
 *      pair that covers 10 with the least wasted capacity, e.g. 4+6=10 exact, preferred over
 *      wasting an 8-top plus a 2-top if both existed)
 * Sorting candidates by capacity ascending and taking the first that fits automatically gives
 * "exact fit, then smallest suitable" as one rule, not two - the smallest capacity >= partySize
 * IS the exact fit whenever one exists.
 */

const candidateTableIds = (allTables, partySize, allowCombination) =>
  (allowCombination ? allTables : allTables.filter((t) => t.capacity >= partySize)).map((t) => t.id);

/** All combinations of `freeTables` with between 2 and `maxTables` members, as arrays of tables. */
function* combinationsOfSize(items, size, start = 0, chosen = []) {
  if (chosen.length === size) {
    yield chosen;
    return;
  }
  for (let i = start; i < items.length; i += 1) {
    yield* combinationsOfSize(items, size, i + 1, [...chosen, items[i]]);
  }
}

/**
 * Smallest number of tables, then smallest total wasted capacity, among combinations that seat
 * the full party. Capped at MAX_COMBINED_TABLES — pushing a party across four or more separate
 * tables stops being a realistic seating plan for a restaurant to execute, so it's treated the
 * same as "no combination available" rather than searched for.
 */
function findBestCombination(freeTables, partySize) {
  let best = null;
  for (let size = 2; size <= Math.min(MAX_COMBINED_TABLES, freeTables.length); size += 1) {
    for (const combo of combinationsOfSize(freeTables, size)) {
      const total = combo.reduce((sum, t) => sum + t.capacity, 0);
      if (total < partySize) continue;
      const waste = total - partySize;
      if (!best || size < best.size || (size === best.size && waste < best.waste)) {
        best = { size, waste, combo };
      }
    }
    // A combination was found at this size - a larger size can only ever add more tables for no
    // benefit (we already prefer fewer tables), so there's no reason to search bigger sizes too.
    if (best) break;
  }
  return best ? best.combo : null;
}

/**
 * Read-only: who could be seated, ignoring the concurrency-safety lock. Used for advisory checks
 * (`check_table_availability`, `find_alternative_times`) where nothing is being committed, so
 * there's nothing to protect with a lock - see docs/DATABASE.md's "Preventing double-booking".
 * `executor` is the shared pool here, or a transaction client when called from the locking path
 * below (same function, different caller).
 */
async function computeAllocation(executor, { allTables, partySize, allowCombination, startAt, endAt, excludeReservationId }) {
  const idsToCheck = candidateTableIds(allTables, partySize, allowCombination);
  if (idsToCheck.length === 0) return null;

  const overlappingIds = await reservationRepository.findOverlappingTableIds(
    executor,
    idsToCheck,
    startAt,
    endAt,
    excludeReservationId
  );
  const idsToCheckSet = new Set(idsToCheck);
  const overlappingSet = new Set(overlappingIds);
  const freeTables = allTables.filter((t) => idsToCheckSet.has(t.id) && !overlappingSet.has(t.id));

  const exactOrSmallestSingle = freeTables
    .filter((t) => t.capacity >= partySize)
    .sort((a, b) => a.capacity - b.capacity)[0];
  if (exactOrSmallestSingle) return [exactOrSmallestSingle];

  if (allowCombination) {
    const combo = findBestCombination(freeTables, partySize);
    if (combo) return combo;
  }

  return null;
}

/**
 * The authoritative, concurrency-safe version: locks every candidate table row for the duration
 * of the caller's transaction before checking, so a second request racing for the same table(s)
 * blocks until this one commits or rolls back. MUST be called with a transaction `client` (see
 * tableRepository.lockByIds) — this is the function create_reservation/modify_reservation use;
 * computeAllocation above is for advisory checks only.
 */
async function allocateWithLock(client, { restaurant, partySize, startAt, endAt, excludeReservationId }) {
  const allTables = await tableRepository.listActive(restaurant.id, client);
  const idsToLock = candidateTableIds(allTables, partySize, restaurant.allowTableCombination);
  if (idsToLock.length > 0) {
    await tableRepository.lockByIds(idsToLock, client);
  }
  return computeAllocation(client, {
    allTables,
    partySize,
    allowCombination: restaurant.allowTableCombination,
    startAt,
    endAt,
    excludeReservationId,
  });
}

/** Advisory-only check, no locking — safe to call as often as needed for "is this free" answers. */
async function checkAvailability(restaurant, { partySize, startAt, endAt, excludeReservationId }, executor = pool) {
  const allTables = await tableRepository.listActive(restaurant.id, executor);
  return computeAllocation(executor, {
    allTables,
    partySize,
    allowCombination: restaurant.allowTableCombination,
    startAt,
    endAt,
    excludeReservationId,
  });
}

module.exports = { allocateWithLock, checkAvailability };
