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
- [x] Invalid quantity (0, negative, over-max) — unit-tested in Phase 6 and enforced by the Phase
      11 zod schema (1-20) at the HTTP layer
- [x] Unauthorized request (no/invalid/garbage/expired token) → 401, verified live and in
      `tests/integration/api.test.js`
- [x] Cross-restaurant access attempt → 404, both at the service layer and the full HTTP layer (a
      valid staff token for restaurant A used against restaurant B's resource; a valid AI session
      token for one session used to read a *different* session's data — `authorizeActor.js` /
      `sessionController.js`)
- [x] SQL injection attempt in a text field (`' OR '1'='1`, a `DROP TABLE` payload in a name field)
      → treated as literal string data, no behavior change — verified live against a running
      server, not just asserted
- [x] XSS payload in a text field (`<script>alert(1)</script>`) → stored/returned as literal text,
      verified it comes back verbatim as a JSON string value
- [x] Path traversal / malformed-id attempt in an id-like field (`../../etc/passwd`, `not-a-uuid`)
      → fails zod UUID validation, 400 (not a raw Postgres error) — both route params
      (`validateUuidParam`) and body fields (`menuItemId`, `reservationId`)
- [x] Negative quantity on an order (unavailable item, unknown item id, and idempotency
      replay/mismatch all covered in `tests/integration/orderEngine.test.js`)
- [x] Invalid/malformed ids (non-UUID strings) — see path traversal row above
- [x] Unexpected extra fields in a request body (mass-assignment attempt, e.g. a client trying to
      set `status` or `restaurantId` directly) → silently stripped by zod, verified live
- [ ] Duplicate state-changing request without an idempotency key racing itself (two concurrent
      identical creates) → exactly one reservation/order row survives
- [x] Invalid AI tool arguments (wrong types, missing required fields) → `VALIDATION_ERROR`, no
      service/repository code reached — `tests/integration/aiTools.test.js`
- [x] A staff JWT against an AI tool endpoint is rejected (403) — tool endpoints are AI-only
- [x] AI tool authorization/tenant isolation — a reservation id for a different restaurant 404s
      through the tool layer the same as through the plain REST API
- [x] AI never gets a success response for an action the backend didn't actually confirm — proven
      by the overflow-booking test in `aiTools.test.js` (every table deliberately filled first,
      then `create_reservation` asserted to return 409 with alternatives, never a false 200)
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
