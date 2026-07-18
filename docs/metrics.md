# Metrics — AARRR funnel + error reporting (S14)

Mannon is instrumented from day one. Two independent systems:

- **PostHog** — the product-analytics **AARRR funnel**. Every funnel signal is a
  *mirror* of the append-only `Event` table.
- **Sentry** — internal error reporting only. No product analytics, no perf traces.

Both are **optional at runtime**: with `POSTHOG_API_KEY` / `SENTRY_DSN` unset the
app runs identically, they simply no-op. Nothing in the request path depends on
either being reachable.

---

## The one rule: analytics derive from the Event stream

Guardrail #6 — the `Event` table is append-only and is the **single source of
truth** for all insight. The F5 dashboard reads that table directly; it never
reads PostHog. PostHog is a downstream mirror so that we can build funnels,
retention curves, and cohorts in a proper analytics tool.

The mirror happens at exactly one chokepoint: **`appendEvent`**
(`app/services/events.server.ts`). Every domain event already flows through it,
so wiring the funnel there means we can never forget to instrument a new event —
if it's worth an `Event` row, it's already mirrored.

```
domain action → appendEvent() → Event row (source of truth)
                              ↘ captureFunnelEvent() → PostHog (best-effort mirror)
```

`captureFunnelEvent` is **best-effort**: it never throws, never blocks, and
enqueues only (PostHog batches + flushes on an interval). It is safe to call
inside a DB transaction — it buffers in memory and does no network I/O on the
hot path. On the rare transaction rollback a mirrored event may still send;
that's an acceptable ~approximation for a product funnel, and the `Event` table
(which *is* rolled back) remains exact.

---

## AARRR mapping

`app/lib/analytics.ts` (pure, exhaustively tested) maps each domain `EventType`
to a funnel event + stage. Events not in the table are intentionally **not**
funnel steps — they still live in the `Event` table and feed the dashboard.

| Stage | Domain event(s) | PostHog event | Meaning |
|---|---|---|---|
| **Acquisition** | `APP_INSTALLED` | `app_installed` | Merchant installed Mannon |
| **Acquisition** | `TRIAL_STARTED` | `trial_started` | 14-day trial began |
| **Activation** | `QUOTE_SUBMITTED` | `quote_submitted` | A buyer sent their first/next quote |
| **Activation** | `QUOTE_COUNTERED` | `quote_countered` | Merchant priced a quote |
| **Activation** | `REORDER_CREATED` | `reorder_created` | One-tap reorder used |
| **Activation** | `AI_PARSE_ACCEPTED` | `ai_order_accepted` | AI Magic Order Pad result confirmed |
| **Revenue** | `QUOTE_ACCEPTED` | `quote_accepted` | Buyer accepted a countered quote |
| **Revenue** | `QUOTE_ORDERED` | `quote_ordered` | Quote became a Shopify draft order |
| **Revenue** | `DRAFT_ORDER_CREATED` | `draft_order_created` | Draft order created in Shopify |
| **Revenue** | `PLAN_UPGRADED` | `plan_upgraded` | Trial → paid, or Starter → Growth |
| **Revenue** | `PLAN_CANCELLED` | `plan_cancelled` | Subscription cancelled |
| **Referral** | `REVIEW_PROMPT_SHOWN` | `review_prompt_shown` | App-store review prompt surfaced |

Not funnel events (dashboard-only): `QUOTE_EXPIRED`.

### Retention

Retention has **no dedicated app event** — it's derived in PostHog from repeat
activation over time (a returning merchant firing `quote_submitted` /
`reorder_created` across weeks). Keeping it out of the code avoids a synthetic
"retention" event that would just restate the activation stream.

---

## Identity & properties

- **distinct id** = the `shopId`. The merchant/store is the funnel subject
  (Mannon is a merchant tool; buyers act *within* a shop's funnel).
- **properties** = `aarrr_stage`, `entity_type`, optional `entity_id`, plus any
  **scalar** fields from the event payload (`funnelProperties` drops nested
  objects/arrays).

### No PII — ever

Event payloads already carry **no PII** — ids and numbers only (guardrail #6,
`data-model.md`). `funnelProperties` is scalar-only as defence in depth. Buyer
emails/names are never sent to PostHog; the funnel is keyed on shop + Shopify
GIDs + counts.

---

## Errors → Sentry

`app/lib/sentry.server.ts` initialises Sentry once at server startup and exposes
`captureException`. Wiring:

- **`entry.server.tsx` → `handleError`** — Remix's server-side hook. Every
  loader / action / render error is reported (aborted requests are ignored —
  the client just navigated away).
- User-facing errors stay **plain-language Polaris `Banner`s / friendly
  `ErrorBoundary` pages** (CLAUDE.md conventions). Sentry is for *us*, not the
  merchant.

`captureException` never throws — reporting an error must not become one.

---

## Configuration

| Env var | Purpose | Unset behaviour |
|---|---|---|
| `POSTHOG_API_KEY` | PostHog project key (server capture) | Funnel mirror no-ops |
| `POSTHOG_HOST` | PostHog host | Defaults to `https://us.i.posthog.com` |
| `SENTRY_DSN` | Sentry project DSN | Error reporting no-ops |

No new OAuth scopes (analytics is internal; see `compliance.md`). No new data is
collected from Shopify — PostHog receives a subset of the events we already
record.
