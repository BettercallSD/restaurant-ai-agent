# Error Handling

## Response envelope

Every error response, from any endpoint, has this shape:

```json
{
  "success": false,
  "error": {
    "code": "RESERVATION_UNAVAILABLE",
    "message": "No table is available at the requested time."
  }
}
```

Success responses are `{ "success": true, ...payload }`. The client (AI orchestrator or
dashboard) branches on `success`, never on HTTP status alone, though status codes are also set
correctly (see below).

No response body ever includes a SQL query, a stack trace, a file path, an env var name, or a
raw driver error message. A centralized Express error-handling middleware is the only place that
formats error responses; route/controller code throws a typed `AppError` (see
`src/errors/AppError.js`) and lets it bubble up.

## Status codes

| Code | Used for |
|---|---|
| 200 | successful read/update |
| 201 | resource created |
| 400 | malformed request (bad JSON, missing required field shape) |
| 401 | missing/invalid authentication |
| 403 | authenticated but not authorized for this resource (tenant mismatch, role) |
| 404 | resource not found (or deliberately hidden — see IDOR note below) |
| 409 | conflict (double-booking race lost, invalid state transition) |
| 422 | well-formed but semantically invalid (e.g. party size 0, player not U23-eligible) |
| 429 | rate limited |
| 500 | unexpected server error (logged internally, generic message externally) |

## IDOR: 403 vs 404

Where a resource's mere existence shouldn't be confirmed to an unauthorized caller (e.g. "does
reservation X exist at all, in some other restaurant"), the handler returns a plain 404 rather than
a 403 that would confirm existence-but-wrong-tenant. Where the caller is clearly authenticated for
*a* restaurant and asks about a resource id that simply isn't theirs, 404 is used uniformly (not
403) specifically so cross-tenant probing can't distinguish "not yours" from "doesn't exist".

## Business error codes (initial set, extended as services are implemented)

| code | meaning |
|---|---|
| `VALIDATION_ERROR` | zod validation failed; `message` summarizes the first failure |
| `RESERVATION_UNAVAILABLE` | no table/combination available at requested time |
| `INVALID_RESERVATION_TRANSITION` | e.g. attempting CANCELLED → CONFIRMED |
| `INVALID_ORDER_TRANSITION` | e.g. attempting to cancel a PREPARING order |
| `RESERVATION_LOCKED` | (reserved for future use, not applicable to this project) |
| `MENU_ITEM_UNAVAILABLE` | ordering an item with `is_available = false` |
| `AWARD_INELIGIBLE` | (not applicable to this project) |
| `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY` | same key, different payload — rejected rather than silently returning the old result |
| `UNAUTHORIZED` | 401 cases |
| `FORBIDDEN` | 403 cases |
| `NOT_FOUND` | 404 cases |
| `RATE_LIMITED` | 429 cases |
| `INTERNAL_ERROR` | generic 500 fallback |

Two lines above reference a different project's categories (`RESERVATION_LOCKED`,
`AWARD_INELIGIBLE`) only to explicitly mark them **not applicable** — this table is restaurant-
specific and will not grow categories belonging to the Funtasy League scoring system.

## Unexpected errors

Any error not explicitly thrown as an `AppError` is caught by the centralized handler, logged
with full detail server-side (via `pino`, request id included), and returned to the client as:

```json
{ "success": false, "error": { "code": "INTERNAL_ERROR", "message": "Something went wrong." } }
```

with status 500. The real error never reaches the response body in any environment, not just
production — there's no "debug mode" toggle that relaxes this, to avoid it accidentally being left
on during the live demo.
