# Integration Guide (for the voice/dashboard partner)

This is the contract you build against. You don't need to know the database schema — everything
you need is the tool/API shapes below and in `AI_TOOLS.md` / `API.md`.

## Voice AI → backend

```
Caller dials restaurant's number
  → your telephony layer identifies which restaurant that number belongs to
  → POST /api/v1/restaurants/:restaurantId/sessions { customerPhone }   (no auth needed — this IS
      the credential-issuing call, see docs/DECISIONS.md)
      → backend returns
        { session: { id, restaurantId, channel, state: {}, status: 'ACTIVE' }, aiToken }
  → every subsequent call for this session sends Authorization: Bearer <aiToken> — it only
    authorizes this one restaurant and this one session id, nothing else (docs/SECURITY.md)
  → your orchestration loop runs: STT → LLM decides intent/tool → call the matching
    POST /api/v1/ai/tools/<tool-name> endpoint (implemented — 13 tools, see AI_TOOLS.md) with that
    Authorization header; there's no restaurantId in these URLs or bodies at all — it's resolved
    from the aiToken, so there's nothing for the AI to redirect even if a prompt tried to
  → backend returns a structured JSON result (never prose) — your LLM turns that into speech via TTS
  → as slots get filled (date, time, partySize, name, ...), PATCH
    /api/v1/restaurants/:restaurantId/sessions/:id { state: {...} } (same aiToken) with the new
    fields so you don't have to carry state yourself between turns
  → POST /api/v1/restaurants/:restaurantId/sessions/:id/messages (same aiToken) to log each turn's
    transcript (optional but recommended — powers the dashboard's "AI activity" view via ai_actions
    + conversation_messages)
  → on call end: the session is just left ACTIVE indefinitely by default (not a bug — there's no
    background job expiring it), or, if you have a clean hangup signal, POST
    /api/v1/restaurants/:restaurantId/sessions/:id/end { status? } ('COMPLETED' by default, or
    'ABANDONED') so the dashboard doesn't show a finished call as still in progress
```

**Important**: the `aiToken` is specific to the session it was issued for. If the same customer
calls back later, that's a *new* session (new `POST .../sessions` call) with its own new
`aiToken` — don't try to reuse an old one across calls.

## Hard rule your orchestrator must follow

**Never tell the customer an action succeeded (booked / cancelled / ordered) unless the
corresponding tool call returned `success: true`.** Every mutating tool
(`create_reservation`, `modify_reservation`, `cancel_reservation`, `create_order`, `modify_order`,
`cancel_order`) returns `success: false` with a structured error and (where relevant) alternatives
on failure — that's your signal to keep the conversation going instead of confirming.

## Idempotency — you must send this

For `create_reservation` and `create_order`, generate a UUID once per logical attempt. **How you
send it depends on which endpoint family you're calling — these are two different mechanisms, not
interchangeable:**
- AI tool calls (`POST /api/v1/ai/tools/create-reservation` / `create-order`): send it as the
  `idempotencyKey` field in the JSON body.
- The plain REST endpoints (`POST /api/v1/restaurants/:id/reservations` / `orders`, used by a
  dashboard or any non-AI client): send it as the `Idempotency-Key` HTTP header instead — the body
  has no `idempotencyKey` field there, and one would be silently stripped, not accepted.

If your telephony layer retries a dropped request, resend the **same** key (in whichever form that
endpoint expects) — the backend returns the original result instead of creating a duplicate
booking/order, even if the retry races the still-in-flight original request. Generate a **new** key
only when the customer is making an actually new request.

## Function-calling schemas

If your LLM provider wants OpenAI-style function-calling JSON Schemas rather than hand-rolled
prompt instructions, pull them from `src/tools/schemas.js` (added in Phase 12) — these are kept in
sync with the actual endpoint validators, so they can't drift out of date with what the backend
will actually accept.

## Dashboard → backend

Standard JWT-bearer REST API (`POST /auth/login`, then `Authorization: Bearer <token>` on
everything else). Staff only see/modify their own restaurant's data — enforced server-side, not by
what your UI chooses to display. See `API.md` for the full endpoint list.

## Errors

Every error response has the same envelope regardless of which endpoint — see `ERROR_HANDLING.md`.
Branch on `response.success`, not just HTTP status, though status codes are also meaningful.
