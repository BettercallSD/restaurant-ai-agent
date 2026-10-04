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
- [ ] Unavailable table → alternatives returned
- [ ] Invalid party size (0, negative, absurdly large)
- [ ] Invalid date (past date, malformed string)
- [ ] Duplicate reservation (same idempotency key, same body) → same result, no second row
- [ ] Duplicate reservation (same idempotency key, different body) → rejected
- [ ] Cancellation (valid transition)
- [ ] Invalid reservation state transition (e.g. `CANCELLED → CONFIRMED`)
- [ ] Modification (valid, re-checks availability)
- [ ] Valid order
- [ ] Unavailable menu item → rejected
- [ ] Invalid quantity (0, negative, over max)
- [ ] Unauthorized request (no/invalid token)
- [ ] Cross-restaurant access attempt (restaurant A's token/session against restaurant B's
      resource) → 404, and the response body proven not to leak that the resource exists
- [ ] SQL injection attempt in a text field (`' OR '1'='1`, `" OR "1"="1`) → treated as literal
      string data, no behavior change
- [ ] XSS payload in a text field (`<script>alert(1)</script>`) → stored/returned as literal text,
      never executed anywhere (this is an API, so the real assertion is "returned verbatim as a
      JSON string, not interpreted")
- [ ] Path traversal attempt in an id-like field (`../../etc/passwd`) → fails UUID validation, 400
- [ ] Negative / huge quantities on an order
- [ ] Invalid/malformed ids (non-UUID strings)
- [ ] Unexpected extra fields in a request body (mass-assignment attempt, e.g. a client trying to
      set `status` or `restaurantId` directly) → ignored, not applied
- [ ] Duplicate state-changing request without an idempotency key racing itself (two concurrent
      identical creates) → exactly one reservation/order row survives
- [ ] Invalid AI tool arguments (wrong types, missing required fields) → `VALIDATION_ERROR`, no
      service/repository code reached
- [ ] Concurrent reservation attempt for the same table/slot → exactly one succeeds, the other
      gets `RESERVATION_UNAVAILABLE` (exercises the exclusion constraint directly, not just the
      application-level check)

## Commands

```bash
npm test                # full suite against DATABASE_URL_TEST
npm run test:unit       # business-logic unit tests only, no DB required
npm run migrate:test    # apply migrations to the test database
```

(Exact script names finalized when `package.json` lands in Phase 3; this file is updated then.)
