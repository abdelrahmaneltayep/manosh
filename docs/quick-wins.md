# Quick wins (§4, PR-7)

Small, low-risk polish that ties off the Pricing v3 + F21 threads from this update.
No new surfaces or behavior gates — each is a self-contained improvement.

## F21 offers now move the AARRR funnel

The offer events were already written to the append-only `Event` table, but the
funnel map (`app/lib/analytics.ts`) didn't recognize them, so PostHog never saw
Make-an-Offer activity. Added:

| Event | Funnel event | Stage |
|---|---|---|
| `OFFER_CREATED` | `offer_created` | activation |
| `OFFER_COUNTERED` | `offer_countered` | activation |
| `OFFER_ACCEPTED` | `offer_accepted` | revenue |
| `OFFER_CONVERTED` | `offer_converted` | revenue |

`OFFER_DECLINED` and `OFFER_RULE_UPDATED` stay **out** of the funnel (Event
table + dashboard only), matching how `QUOTE_EXPIRED` is handled. No new wiring
was needed: `appendEvent → captureFunnelEvent → funnelEventFor` already emits
whatever the map contains. Covered by `analytics.test.ts`.

## Pricing v3 trust line — one source of truth

`NO_PER_ORDER_FEES_COPY` (`app/lib/billing-v3.ts`) was defined but unused, while
the Settings → Plan & billing card hardcoded the same sentence. Settings now
renders the constant, so the "no per-order fees" promise has a single source of
truth (it appears verbatim in the plan comparison and anywhere else we reuse it).

## Demo Make-an-Offer seed data

`prisma/seed.ts` now seeds, idempotently, a widget config, one margin-safe
`OfferRule` ("House rule"), and a pending buyer `Offer` (~82% of list, in the
counter band) for the demo shop — so a fresh install shows the Offers admin with
something to act on instead of an empty queue. Guarded like the demo install
event: the widget config upserts on the unique `shopId`; the rule and offer are
created only when none exist yet.
