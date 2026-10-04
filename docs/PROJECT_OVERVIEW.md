# Project Overview

## Problem

Small and mid-size restaurants in Nepal mostly take reservations and orders over the phone,
answered by whichever staff member is free. This doesn't scale past a few tables, loses orders
to mishearing/miswriting, and goes completely dark outside staffed hours. Customers also routinely
mix English, Nepali, and Nepali-English code-switching in the same sentence, which rules out
simple IVR ("press 1 for reservations") systems.

## Target customers

Independent restaurants and small chains in Nepal who want to stop losing calls/orders to staff
availability, without hiring a dedicated call-handling team.

## Product

An AI phone agent that answers a restaurant's line, understands the caller in English, Nepali, or
code-switched speech, and actually performs reservation and ordering actions against the
restaurant's real data (tables, menu, availability) — not a scripted IVR, and not a chatbot that
only describes what it could theoretically do.

**AI is an operational interface to the restaurant backend, not merely a conversational layer.**
Remove the AI and the product stops working entirely — there is no fallback UI a customer could
use instead over the phone. The AI's only path to affecting the restaurant's data is through a set
of narrow, validated backend tools; it cannot read or write the database directly, and it cannot
claim an action succeeded unless the backend has confirmed it.

## Role split

- **AI role**: Interpret natural (and mixed-language) speech into structured intent and slot
  values, decide which tool to call and when, hold a conversation naturally including asking for
  missing information, and relay backend results back to the customer in natural language. The AI
  never performs business logic itself (pricing, availability, authorization) — it only calls
  tools and reports their results.
- **Backend role (this repo, my scope)**: REST API, database, reservation engine, table
  allocation, order engine, the AI tool/function layer those orchestration calls hit, conversation
  session persistence, AI action logging, multi-tenant authorization, validation, and security.
- **Partner's role**: Telephony integration, speech-to-text, text-to-speech, the voice/LLM
  orchestration loop itself (deciding *which* tool to call from the LLM's output), the restaurant
  dashboard UI, restaurant setup UI, and frontend auth screens.

## Hackathon scope

One restaurant tenant is enough to demo convincingly, but the data model and authorization layer
are genuinely multi-tenant from day one — faking single-tenant now and retrofitting isolation
later is how IDOR bugs happen. Payments are out of scope (orders track totals, not payment
capture). Admin/staff login is minimal (email + password) since the dashboard is the partner's
surface, not a product feature we're showcasing.

## Future scope (explicitly not v1)

- Pulling real PFA award data for Golden Boot / Player of the Season style categories — N/A, this
  project has no award categories (that's the unrelated Funtasy League project).
- Payment capture/refunds.
- SMS/WhatsApp confirmation messages.
- Multi-location restaurant groups sharing a menu across branches.
- Real STT/TTS language-detection confidence scoring feeding back into backend validation strictness.
