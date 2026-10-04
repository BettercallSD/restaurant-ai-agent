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

```bash
cp .env.example .env     # fill in DATABASE_URL, JWT_SECRET, etc.
npm install
npm run migrate          # applies all migrations
npm run seed              # seeds "Himalayan Bites" sample restaurant
npm run dev                # starts the API on PORT (default 3000)
```

(Finalized exact commands land with `package.json` in Phase 3 — this section is kept accurate as
each piece is built, per `docs/DEVELOPMENT.md`.)

## Status

Phase 2 of 18 (see `docs/DEVELOPMENT.md`) — architecture and documentation complete, implementation
starting with the database schema.
