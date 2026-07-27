# Feature 7 — Quote Analytics & Sales Dashboard (Growth)

A negotiation-analytics dashboard — win rate, average discount, time-to-close,
open pipeline, top accounts, and a most-discounted-SKU leaderboard. Most rivals
show orders; this shows the negotiation.

## Plan availability

Growth only. Starter sees a **locked, blurred preview** with an upgrade CTA.
Gated with `requireBilling` + `featureAccess(status, GROWTH_PLAN)` on the loader,
the CSV export route, and the cron. Dark-launched behind `MANNON_FF_QUOTE_ANALYTICS`.

## Metrics (all derived — no new core tables)

Computed from existing `Quote` (+ lines) and the append-only `Event` stream by the
pure lib `app/lib/analytics-quotes.ts`:

- **Win rate** = won / (won + lost); won = ACCEPTED/ORDERED, lost = EXPIRED.
- **Avg discount** = value-weighted reduction of each won line vs the customer's
  **F3 price-list** entry (quotes without a list are excluded).
- **Avg time-to-close** = created → terminal hours across won quotes.
- **Open pipeline** = Σ value of SUBMITTED/COUNTERED quotes.
- **Top accounts**, **most-discounted SKUs**, **stale quotes** (open ≥ 7 days).

The dashboard computes these **live** for the range (30/90 days), so it works
without waiting for the rollup. Money is in one store currency (the default price
list's currency, else USD) — currencies are never mixed in a total.

## Rollup + digest

`QuoteMetricDaily` (one row per shop per day) is built by
`/internal/cron/analytics` (POST/GET, `x-cron-secret: $CRON_SECRET`, not a Shopify
webhook). Schedule it daily (Fly machine / GitHub Action / Routine). On Mondays it
also sends the opt-in **weekly digest** to Growth shops with `Shop.weeklyDigest`
on (`weekly_digest` template; delivery via the F2 mailer, no-op until configured).

## Data model (migration `f7_quote_analytics`)

- `QuoteMetricDaily` (rollup), `Shop.weeklyDigest` (opt-in), event `ANALYTICS_VIEWED`.

## Notes

CSV export (`/app/analytics/export`) streams the underlying quotes. Empty state
until `MIN_QUOTES_FOR_ANALYTICS` (5) quotes exist. Ties into F8 (stale-quote
nudges) once shipped.
