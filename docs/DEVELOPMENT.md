# Development Log

## Current phase
Phase 3 complete (database schema + migrations, verified against a real local Postgres). Starting
Phase 4 (seed data).

## Completed
- Phase 1: Repository inspection — repo was empty (README + .gitignore only), nothing to reuse.
- Phase 2: Architecture decided (Node/Express/plain-JS, raw `pg` + parameterized SQL, no ORM,
  zod validation, JWT staff auth, UUID PKs, cents-based pricing, idempotency keys, Postgres
  `SELECT ... FOR UPDATE` row-locking transaction for double-booking). Full docs written:
  PROJECT_OVERVIEW, ARCHITECTURE, DATABASE, API (skeleton), AI_TOOLS, AGENT_FLOW, SECURITY
  (threat model), ERROR_HANDLING, TESTING (strategy + checklist), DECISIONS, INTEGRATION,
  DEMO_SCENARIOS.
- Phase 3: `package.json`, `src/config/env.js` (fail-fast env validation via zod),
  `src/db/pool.js` (shared `pg` pool, `query`/`withTransaction` helpers), and 7
  `node-pg-migrate` migrations covering all 16 tables (the 14 from `DATABASE.md` plus
  `reservation_tables` and `pgmigrations` itself). Verified for real: ran `up` against a local
  Postgres 16, inspected the resulting schema (generated `time_range` column, constraints,
  triggers all present as designed), ran `down` 7 and back `up` cleanly, applied to both the dev
  and test databases. `npm audit --omit=dev` is clean (0 vulnerabilities) after pinning
  `bcrypt@^6` — see `SECURITY.md`.

## Current task
Phase 4: seed data for "Himalayan Bites" (one realistic Nepali restaurant — tables, menu,
categories, opening hours) via a seed script, not hardcoded in source.

## Next task
Phase 5: repository/data-access layer (the only code allowed to touch `pg` directly, per
`ARCHITECTURE.md`'s layering).

## Known issues
- `reservation_tables` combination-seating (`allow_table_combination`) is schema-ready but the
  allocation algorithm implementing it lands in Phase 7/8, not before.
- Dev-dependency `braces` (via `jest`) has an open high-severity advisory; tracked in
  `SECURITY.md`, not in the production dependency tree.

## Important decisions
See `DECISIONS.md` for the full ADR log. Summary: no ORM, UUID PKs, cents pricing, Postgres
`SELECT ... FOR UPDATE` row-locking transaction for double-booking, idempotency via
`Idempotency-Key` + unique constraint, short-lived JWT with no refresh rotation (v1 scope).

## Definition of Done tracking
- [x] Architecture + docs
- [x] Database can be created from scratch
- [x] Migrations work (verified up/down/up against a real Postgres instance)
- [ ] Seed data works
- [ ] Backend starts successfully
- [ ] REST API works
- [ ] Reservations work
- [ ] Table allocation works
- [ ] Alternative times work
- [ ] Reservation modification works
- [ ] Cancellation works
- [ ] Orders work
- [ ] Menu availability works
- [ ] AI tools work
- [ ] AI cannot directly access the database
- [ ] Backend validates AI tool arguments
- [ ] Conversation/session state works
- [ ] AI actions are logged
- [ ] Partner integration is documented (first draft done — `INTEGRATION.md`; finalized Phase 16)
- [ ] Security tests pass
- [ ] Automated tests pass
- [ ] No secrets are committed
- [ ] Tenant isolation works
- [ ] SQL injection protection works
- [ ] Duplicate requests are handled
- [ ] Transactions are used where necessary
- [ ] Documentation matches actual implementation
- [ ] Fresh setup is documented
- [ ] A new developer can clone, configure `.env`, migrate/seed, start, and test from the README
