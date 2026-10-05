# Restaurant AI Agent

AI-powered restaurant phone agent for Nepal. Customers call a restaurant and talk naturally — in
English, Nepali, or Nepali-English code-switching — to check the menu, book a table, or place an
order. The AI is a genuine operational interface to a real backend (reservation engine, table
allocation, order engine), not a scripted IVR or a chatbot that only describes what it could do.
See `docs/PROJECT_OVERVIEW.md`.

This repo is the **backend**: REST API, database, reservation/order engines, and the AI tool layer
a voice/LLM orchestration loop calls into. Telephony, STT/TTS, the orchestration loop itself, and
the dashboard/setup UIs are built separately (see `docs/INTEGRATION.md` for the contract between
the two).

## Stack

Node.js, Express, PostgreSQL (`pg`, parameterized queries, no ORM), `zod` validation, JWT staff
auth, `node-pg-migrate`, Jest + Supertest. See `docs/ARCHITECTURE.md` for why.

## Documentation

| File | Contents |
|---|---|
| `docs/PROJECT_OVERVIEW.md` | problem, scope, role split |
| `docs/ARCHITECTURE.md` | layering, data flow, diagrams |
| `docs/DATABASE.md` | full schema, constraints, concurrency |
| `docs/API.md` | REST endpoint reference |
| `docs/AI_TOOLS.md` | every AI tool's contract |
| `docs/AGENT_FLOW.md` | conversation state machine, example flows |
| `docs/SECURITY.md` | threat model, mitigations, audit checklist |
| `docs/ERROR_HANDLING.md` | error envelope, status codes, error catalog |
| `docs/TESTING.md` | test strategy and required cases |
| `docs/DEVELOPMENT.md` | current phase, progress log (read this first each session) |
| `docs/DECISIONS.md` | architecture decisions and why |
| `docs/INTEGRATION.md` | how the voice/dashboard partner connects |
| `docs/DEMO_SCENARIOS.md` | the scripted hackathon demo flows |

## Setup

Requires Node 18+ and a Postgres database (local or Neon free tier).

```bash
cp .env.example .env       # fill in DATABASE_URL, DATABASE_URL_TEST, JWT_SECRET, AI_SESSION_SECRET
npm install
npm run migrate            # applies all migrations
npm run seed                # seeds "Himalayan Bites" sample restaurant
npm run dev                  # starts the API on PORT (default 3000), auto-restarts on change
```

Verify it's up: `curl http://localhost:3000/health` → `{"success":true,"status":"ok"}`.

```bash
npm test                    # migrates + seeds DATABASE_URL_TEST, then runs the full test suite
```

Reservation/order endpoints require `Authorization: Bearer <token>` — either a staff JWT from
`POST /api/v1/auth/login` (seeded login: `owner@himalayanbites.test` / `ChangeMe123!`), or the
`aiToken` returned by creating a session (`POST /api/v1/restaurants/:id/sessions`, no auth
required — see `docs/API.md`).

## Status

Phase 14 of 18 complete (see `docs/DEVELOPMENT.md`) — database, reservation/order engines, the REST
API, real authentication/authorization/validation/rate-limiting, the full AI tool layer (13 tools,
`docs/AI_TOOLS.md`), conversation-session state (transcript retrieval, explicit session-end, and a
dashboard-facing AI-action-log endpoint), and structured/redacted logging are built and
integration-tested (95 passing tests, including the full agentic check→book→confirm flow and live
SQL-injection/XSS/mass-assignment/rate-limit/cross-tenant/log-redaction checks against a running
server). Expanding automated test coverage toward the full `docs/TESTING.md` checklist is next.
