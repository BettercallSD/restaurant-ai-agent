# Development Log

## Current phase
Phase 2 complete (architecture + documentation). Starting Phase 3 (database schema + migrations).

## Completed
- Phase 1: Repository inspection — repo was empty (README + .gitignore only), nothing to reuse.
- Phase 2: Architecture decided (Node/Express/plain-JS, raw `pg` + parameterized SQL, no ORM,
  zod validation, JWT staff auth, UUID PKs, cents-based pricing, idempotency keys, Postgres
  exclusion constraint for double-booking). Full docs written: PROJECT_OVERVIEW, ARCHITECTURE,
  DATABASE, API (skeleton), AI_TOOLS, AGENT_FLOW, SECURITY (threat model), ERROR_HANDLING,
  TESTING (strategy + checklist), DECISIONS, INTEGRATION, DEMO_SCENARIOS.

## Current task
Phase 3: write `package.json`, `src/db/` connection pool, and `node-pg-migrate` migrations for
all 14 tables in `DATABASE.md`, including the `tsrange` exclusion constraint on reservations.

## Next task
Phase 4: seed data for "Himalayan Bites" (one realistic Nepali restaurant — tables, menu,
categories, opening hours) via a seed script, not hardcoded in source.

## Known issues
None yet — no code written besides docs.

## Important decisions
See `DECISIONS.md` for the full ADR log. Summary: no ORM, UUID PKs, cents pricing, Postgres
exclusion constraint (not just app-level locking) for double-booking, idempotency via
`Idempotency-Key` + unique constraint, short-lived JWT with no refresh rotation (v1 scope).

## Definition of Done tracking
- [x] Architecture + docs
- [ ] Database can be created from scratch
- [ ] Migrations work
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
