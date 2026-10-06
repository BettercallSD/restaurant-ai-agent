# Security

Status: **final security audit complete (Phase 17)**. Every mitigation below is implemented,
integration-tested, and — for the ones where that's meaningful — verified live against a running
server, not just asserted. The Phase 17 pass itself was run skeptically rather than as a rubric
check: it re-derived and actually tested three claims this document had been resting on (that an
identical error message is sufficient against enumeration — it wasn't, a timing side-channel
remained; that query-string input didn't need the same validation body fields already got — it
did; that an unused-but-written validation function meant the validation was actually wired up — it
wasn't) and found all three wrong. All four findings from that pass (those three plus the
`X-Powered-By` header) are fixed, tested, and documented inline below with a file reference.

## Threat model

| Threat | Mitigation |
|---|---|
| SQL injection | No raw SQL concatenation anywhere; every repository query is parameterized (`$1, $2, ...` via `pg`). Verified live with real injection payloads against a running server (`tests/integration/api.test.js`), not just by inspection. |
| IDOR / cross-tenant access | Every restaurant-owned query is scoped by a `restaurant_id`; `src/middleware/authorizeActor.js` resolves which restaurant(s) the authenticated actor may touch (JWT → `restaurant_users`, or AI session token → its own `restaurantId` claim, further narrowed to its own `sessionId` for session routes — `src/controllers/sessionController.js`) — never from a client-sent field. See `ARCHITECTURE.md`. Cross-tenant lookups return 404, not 403 (`ERROR_HANDLING.md`), verified in `tests/integration/api.test.js`. Found and closed a narrower instance of the same class of bug in Phase 16: `get_reservation` (AI tool) resolved a reservation by id scoped only to the restaurant, not the specific customer — a caller who knew (or guessed) a valid reservation id for the right restaurant could read it regardless of whose it was. Fixed so a `customerPhone` asserted alongside a `reservationId` must actually match that reservation's customer, or it's a 404 — `reservationService.getReservation`, tested in `tests/integration/aiTools.test.js`. |
| Broken authentication | `src/services/authService.js`: bcrypt-hashed passwords + short-lived JWT access tokens (`src/utils/jwt.js`); identical error on wrong password vs. unknown email. **Phase 17 found this alone wasn't enough**: `bcrypt.compare` was short-circuited away for a nonexistent email, so a real email with a wrong password took ~300ms while a nonexistent one returned in ~1.5ms — a trivially measurable timing side-channel that let an attacker enumerate staff emails by response time alone, identical wording notwithstanding. Measured with a real reproduction script before and after the fix (not assumed): `authService.js` now always runs `bcrypt.compare` against either the real hash or a fixed dummy hash, closing the gap to ~292ms vs ~294ms. No passwords for customers/AI callers — an AI session token (`src/controllers/sessionController.js`) is issued per phone call and scoped to one restaurant + one session. |
| Broken authorization / privilege escalation | Role (`owner`/`manager`/`staff`) checked server-side from `restaurant_users` (`authorizeActor.js`), never from a client-sent role claim. Platform-admin (`users.is_platform_admin`) is a separate, more-privileged flag, also server-side only (not yet wired to any route — no platform-admin endpoints exist yet). |
| Mass assignment | Two layers: controllers explicitly whitelist fields passed into services (never `createReservation(req.body)`), and zod schemas (`src/validators/`) strip unrecognized fields by default. A client sending `status`/`restaurantId` in a reservation body is silently ignored — verified live (`tests/integration/api.test.js`). |
| Malicious AI tool arguments / prompt injection | Implemented and tested (`src/controllers/aiToolController.js`, `tests/integration/aiTools.test.js`). The AI is treated as untrusted input, identically to a public API client — every tool call goes through the same zod validation + `authorizeActor`-equivalent (`requireAiActor.js`) + business logic as the equivalent REST action, with no tool-specific shortcut. There is no tool that returns bulk customer data (verified by asserting no tool name matches `customer/phone/list/dump/export`), and every id-bearing tool (`get_reservation`, `cancel_reservation`, ...) re-resolves tenant ownership the same way the REST endpoints do — a reservation id for a different restaurant 404s regardless of how the AI was told to phrase the request. |
| Arbitrary tool execution | The AI can only invoke the fixed, documented tool endpoints (`AI_TOOLS.md`, 13 routes in `src/routes/aiToolRoutes.js`) — there is no generic "run this SQL" or "call this endpoint" tool, and no `:restaurantId` in any tool's URL or body schema for the AI to redirect a call with. |
| Tenant data leakage | Response shaping is explicit per endpoint/tool (documented field lists); no endpoint returns a raw database row. AI-facing responses are even narrower than the dashboard-facing REST ones — e.g. `get_reservation`'s tool output returns table *labels* ("T5"), never the raw table ids the plain REST API includes. |
| Oversized requests | `express.json({ limit: '32kb' })` (tool/API bodies are small structured objects, not files). |
| Unvalidated query-string input | Every request *body* field went through `validate` (zod) from Phase 11 on, but `?categoryId=` on `GET .../menu` was a query-string parameter that slipped through that net entirely — found in Phase 17 by actually sending a malformed value and getting a raw 500 instead of a clean 400. Added `validateQuery` (`src/middleware/validate.js`) and a schema for it; also closed a related gap found in the same pass: a `categoryId` belonging to a different restaurant (or no restaurant at all) silently returned every category with empty items instead of 404ing — `menuRepository.categoryExists` had existed since Phase 5 but nothing ever called it. Both REST and the `get_menu` AI tool shared the same bug (and now the same fix, via `src/services/menuService.js`). |
| Brute force | `src/middleware/rateLimiters.js`: `authLimiter` (10/15min) on `/auth/login`, `sessionCreateLimiter` (30/15min) on the unauthenticated session-creation endpoint, `mutationLimiter` (60/15min) on reservation/order create/modify/cancel, `aiToolLimiter` (300/15min, more generous since one conversation turn can mean several tool calls) on every `/ai/tools/*` endpoint, and `publicReadLimiter` (300/15min) on the public restaurant/menu/tables reads — this last one was missing entirely until the Phase 17 audit caught it; the brief's own guidance calls out "public information" as its own limiter class, and it had been skipped. In-memory store, single-instance only — see `DECISIONS.md`/code comments for the multi-instance caveat, and the `trust proxy` note below. Verified live: rapid repeated login attempts get a 429 (`tests/integration/api.test.js`). |
| Framework fingerprinting | `app.disable('x-powered-by')` (`src/app.js`) — found live in Phase 17 (every response was carrying `X-Powered-By: Express` for free) and confirmed removed, both live and in `tests/integration/api.test.js`. |
| Duplicate state-changing requests | Idempotency keys on reservation/order creation (`DATABASE.md`), integration-tested including a genuine concurrent-request race. |
| Leaked secrets | All secrets via `.env` (gitignored); `.env.example` has placeholders only; no secret is ever logged. |
| Verbose production errors | Centralized error handler (`src/middleware/errorHandler.js`) strips internals in every environment (`ERROR_HANDLING.md`). |
| Unsafe logs | `src/config/logger.js`: structured `pino` logging via `pino-http`, with `redact` paths covering `Authorization`/`Cookie` headers and any `password`/`passwordHash`/`token`/`aiToken` field. Request *bodies* are never logged at all (pino-http's default), which keeps customer names/phone numbers out of logs without needing a redaction rule per field. Verified live: issued a real staff JWT, exercised several authenticated endpoints, then grepped the raw token value against the log file — zero matches, every occurrence shows `"authorization":"[REDACTED]"`. |
| XSS | No user-supplied text is ever rendered as raw HTML — this is an API-only backend (no server-rendered views); the dashboard (partner's React/whatever frontend) is responsible for its own output-encoding of any text it displays, but this backend never emits an HTML response. |
| CSRF | Not applicable to a stateless, JWT-bearer-token API with no cookie-based session auth. |

## Authentication model (implemented, Phase 11)

- **Staff/dashboard**: `POST /api/v1/auth/login` (email + password, `src/services/authService.js`)
  → short-lived JWT access token (`JWT_EXPIRES_IN`, default 15m), `Authorization: Bearer <token>`
  on subsequent requests. No refresh-token rotation in v1 (hackathon scope); token lifetime is kept
  short enough that this is an acceptable tradeoff (`DECISIONS.md`).
- **AI orchestration**: a JWT signed with a *separate* secret (`AI_SESSION_SECRET`, not
  `JWT_SECRET` — `src/utils/jwt.js`) is issued by `POST /restaurants/:id/sessions`
  (`src/controllers/sessionController.js`) when a `conversation_session` is created for that
  restaurant's line. The orchestrator presents it as `Authorization: Bearer <aiToken>` on every
  subsequent call for that session; `authorizeActor.js` checks its `restaurantId` claim against the
  URL, and for session routes specifically, `sessionController.js` additionally checks its
  `sessionId` claim — a token for one call cannot read or modify a *different* call's session, even
  for the same restaurant (integration-tested).
- **Session creation itself is unauthenticated** — see `DECISIONS.md` for why and what the
  compensating control is (rate limiting).
- **Platform admin**: `users.is_platform_admin = true`, checked server-side, not yet wired to any
  route — no platform-admin endpoints exist yet (reserved for an internal ops endpoint if time
  allows).

## Known limitation: `trust proxy` is deployment-dependent, left unset deliberately

`express-rate-limit` keys its counters off `req.ip`. If this app runs behind a reverse proxy or
load balancer (common on most hosting platforms), Express needs `app.set('trust proxy', ...)`
configured correctly for `req.ip` to reflect the real client rather than the proxy — and set
*correctly* matters both ways: leaving it unset behind a real proxy makes every client share one
rate-limit bucket (the proxy's own IP), while setting it to blindly trust `X-Forwarded-For` behind
*no* proxy lets any client spoof their own rate-limit identity for free. Guessing at this without
knowing the actual deployment target (how many hops, which platform) risks getting it wrong in the
more dangerous direction. Left unset here; whoever deploys this needs to set it to match their
actual infrastructure — noted here explicitly rather than silently assumed one way or the other.

## Dependency audit (Phase 3 checkpoint)

`npm audit --omit=dev` on the production dependency tree: **0 vulnerabilities** (verified by
actually running it, not assumed — `bcrypt` was pinned to `^6.0.0` specifically because `5.x`
pulled in a vulnerable transitive `tar`/`@mapbox/node-pre-gyp` chain used only at native-module
install time).

`npm audit` including devDependencies currently reports high-severity advisories against `braces`
(a transitive dependency of `jest`'s file-watching/matching stack, a ReDoS on crafted glob
patterns). This is dev-only test tooling — never part of the deployed server's dependency tree —
and the available fix requires `jest@30`, a breaking major version bump. Accepted as a known,
tracked v1 risk rather than destabilizing the test runner under hackathon time pressure; re-checked
in the Phase 17 final audit before declaring the backend complete.

## Final audit (Phase 17)

- [x] No SQL string concatenation (re-swept with a repo-wide grep for template-literal/concat SQL
      building this phase — zero hits beyond the already-parameterized `query()` calls)
- [x] Parameterized queries everywhere
- [x] No hardcoded secrets (re-swept this phase: `.env` never committed per `git log`, no secret
      pattern in any tracked file beyond test fixtures and the documented dev-only seed password)
- [x] `.env` ignored
- [x] Authentication implemented where required (staff JWT, AI session token)
- [x] Authorization implemented (`authorizeActor.js`, role lookup, session-scoping)
- [x] Restaurant tenant isolation (integration-tested, including cross-tenant and cross-session)
- [x] No IDOR (404, not 403, on a mismatch — verified live and in tests; Phase 16 closed a gap in
      `get_reservation`'s phone-matching; see the threat-model row)
- [x] Input validation (zod on every body field since Phase 11; Phase 17 found and closed the one
      gap — an unvalidated query-string parameter — see the threat-model row)
- [x] Mass-assignment protection (whitelisted fields + zod's default key-stripping)
- [x] Safe error responses
- [x] Rate limiting (now covering all five endpoint classes the brief calls out — auth, public
      information, session creation, reservations/orders, AI tools — Phase 17 added the one that
      had been missing, public information)
- [x] Duplicate-request protection (including the real concurrent-same-key race found and fixed in
      Phase 15)
- [x] Transaction safety
- [x] AI tool authorization (`requireAiActor.js` — AI session token required, staff JWT rejected
      with 403, verified live and in `tests/integration/aiTools.test.js`)
- [x] AI cannot bypass backend authorization (every tool runs the same zod validation +
      business-logic path as the equivalent REST endpoint; cross-tenant and unavailable/invalid
      cases all verified through the tool layer specifically, not assumed from the REST tests)
- [x] AI cannot directly access DB (true by construction — `aiToolController.js` only ever calls
      the same services everything else uses, never a repository or `pg` directly)
- [x] Sensitive information not exposed (password hash never returned; AI/staff tokens signed with
      separate secrets; `restaurant_id` never trusted from a client field; `X-Powered-By` disabled
      as of Phase 17 — framework fingerprinting is minor, but free to remove)
- [x] Safe logging (structured `pino`/`pino-http`, redaction verified live against a running
      server — see the threat-model row above)
- [x] Dependency audit (`npm audit --omit=dev`: 0 vulnerabilities, re-run fresh this phase, not
      assumed stale from Phase 3)
- [x] Security tests passing (SQL injection, XSS, mass assignment, auth bypass attempts, cross-
      tenant/cross-session access, and rate limiting all verified both in the automated suite and
      live against a running server)

## Known tradeoffs (documented, not defects)

Every item below is a deliberate scope decision, stated plainly rather than left implicit:

- No refresh-token rotation for staff JWTs (short expiry is the mitigation — `DECISIONS.md`).
- Rate limiting uses an in-memory store; correct for one instance, would under-count across
  several — a shared store (Redis) is the fix if this ever runs horizontally scaled.
- `trust proxy` is unset (see the dedicated note above) — must be set to match whatever reverse
  proxy, if any, actually sits in front of this in a real deployment.
- `POST /sessions` is intentionally unauthenticated (`DECISIONS.md`) — a production deployment
  would gate it behind a restaurant-specific API key for the telephony integration.
- No dashboard staff-write endpoints yet (table/menu-item create/edit, a reservation list view) —
  the auth mechanism exists, they're simply not built, since the agentic core was the priority.
- `users.is_platform_admin` is checked server-side but not wired to any route yet — no
  platform-admin endpoints exist to need it.
- Dev-only `jest`/`braces` advisory (never in the production dependency tree) is tracked, not
  silently ignored — see the dependency audit above.
