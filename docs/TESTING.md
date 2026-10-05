# Testing

Status: strategy defined now, suite built in Phase 15 and extended as each engine lands.

## Strategy

- **Unit tests** for pure business logic that doesn't need a database: table allocation selection
  algorithm, pricing math, state-transition validation, alternative-time search.
- **Integration tests** (Jest + Supertest) against a real disposable PostgreSQL database
  (`DATABASE_URL_TEST`), migrated fresh before the suite runs. Each test runs inside a transaction
  that's rolled back afterward, so tests don't leak state into each other.
- **AI tool integration tests** specifically exercise the full `tool endpoint → service →
  repository → database` path, asserting the exact structured JSON shape documented in
  `AI_TOOLS.md` — these are what prove the AI genuinely can't bypass business logic, not just that
  the HTTP route exists.

## Required cases (tracked here, checked off as implemented)

- [ ] Valid reservation
- [x] Unavailable table → alternatives returned (`tests/integration/reservationEngine.test.js`)
- [x] Invalid party size (0 — DB check constraint). Negative/absurdly-large covered at the Phase
      11 validator layer once zod schemas exist; the service layer already rejects 0 via Postgres.
- [x] Invalid date (past date). Malformed string covered at the Phase 11 validator layer (zod).
- [x] Duplicate reservation (same idempotency key, same body) → same result, no second row
- [x] Duplicate reservation (same idempotency key, different body) → rejected
- [x] Cancellation (valid transition, and idempotent re-cancellation)
- [x] Invalid reservation state transition (modifying/re-transitioning a CANCELLED reservation)
- [x] Modification (valid, re-checks availability)
- [x] Valid order (priced from the database, a smuggled client-side price field ignored)
- [x] Unavailable menu item → rejected
- [x] Invalid quantity (0, negative — unit-tested in Phase 6; over-max bound enforced once the
      Phase 11 zod schema lands)
- [ ] Unauthorized request (no/invalid token)
- [x] Cross-restaurant access attempt → 404 at the service layer (`tenant isolation` suite).
      Full HTTP-layer version (restaurant A's token against restaurant B's resource) lands with
      Phase 11 auth.
- [ ] SQL injection attempt in a text field (`' OR '1'='1`, `" OR "1"="1`) → treated as literal
      string data, no behavior change
- [ ] XSS payload in a text field (`<script>alert(1)</script>`) → stored/returned as literal text,
      never executed anywhere (this is an API, so the real assertion is "returned verbatim as a
      JSON string, not interpreted")
- [ ] Path traversal attempt in an id-like field (`../../etc/passwd`) → fails UUID validation, 400
- [x] Negative quantity on an order (unavailable item, unknown item id, and idempotency
      replay/mismatch all covered in `tests/integration/orderEngine.test.js`)
- [ ] Invalid/malformed ids (non-UUID strings)
- [ ] Unexpected extra fields in a request body (mass-assignment attempt, e.g. a client trying to
      set `status` or `restaurantId` directly) → ignored, not applied
- [ ] Duplicate state-changing request without an idempotency key racing itself (two concurrent
      identical creates) → exactly one reservation/order row survives
- [ ] Invalid AI tool arguments (wrong types, missing required fields) → `VALIDATION_ERROR`, no
      service/repository code reached (Phase 11/12 — needs the zod schemas and tool endpoints)
- [x] Concurrent reservation attempt for the same table/slot → exactly one succeeds, the other
      gets `RESERVATION_UNAVAILABLE`. Verified with a genuine `Promise.allSettled` race against a
      real Postgres connection pool (not mocked) in
      `tests/integration/reservationEngine.test.js` — two parties of 8 racing for the one
      remaining table after every other table is deliberately filled first.

## Commands

```bash
npm test                # migrates + seeds the test DB, then runs the full suite against it
npm run test:unit       # business-logic unit tests only, no DB required
npm run migrate:test    # apply migrations to the test database
npm run seed:test       # seed Himalayan Bites into the test database
```

`npm test` is self-contained — it migrates and seeds `DATABASE_URL_TEST` before running Jest, so
a fresh checkout only needs that env var set to a real (empty) Postgres database.

(Exact script names finalized when `package.json` lands in Phase 3; this file is updated then.)
