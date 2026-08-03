# Pricing v3 — 4-plan ladder + grandfathering (PR-1)

Replaces the 2-plan Starter $29 / Growth $79 setup with a four-plan ladder priced
below the mainstream quote-app field. **Additive and flag-gated behind
`MANNON_FF_PLAN_V3`** — off by default, so the live app (and the in-flight App
Review) keeps the legacy behaviour until the flag is flipped.

## The ladder (§1.1)

| Handle | Name | Monthly | Annual (2 mo free) | Trial |
|---|---|---|---|---|
| `free` | Free | $0 | — | — |
| `starter` | Starter | $9 | $90/yr | 14-day |
| `growth` | Growth | $29 | $290/yr | 14-day |
| `scale` | Scale | $69 | $690/yr | 14-day |

Prices live in `PLAN_PRICING_V3` (`app/lib/billing-v3.ts`) as **integer cents**.
Free is the absence of a paid subscription — it has no Shopify billing entry.

## Grandfathering (the non-negotiable)

**Billing never silently raises anyone.** The v3 plans use *lowercase* Shopify
subscription names (`starter`/`growth`/`scale`), which never collide with the
legacy capitalized `Starter`/`Growth` subscriptions. So:

- Existing legacy subs stay chargeable at their original price (`BILLING_CONFIG`
  entries are kept alongside the v3 ones).
- On reconcile, a legacy sub is flagged `Shop.legacyPlan = true` with
  `Shop.legacyPriceCents` = its old price (2900 / 7900), and its **capabilities map
  up**: legacy Starter → Growth caps, legacy Growth → Scale caps
  (`resolveGrandfather`, `effectivePlanHandle`, `resolveV3PlanFromName`).
- A fresh v3 shop maps by its own tier with no legacy price.

## Capability map (§1.3)

`PLAN_CAPABILITIES` in `app/lib/billing-v3.ts` — quotes cap, company accounts,
price lists, AI counter (growth+), Make-an-Offer tier (teaser → manual+3 → auto),
net terms / deposits (growth+), analytics depth, and sales-rep / accounting /
white-label (scale only). `getPlanCapabilities(plan, legacy)` resolves it with
grandfathering.

## Gating

- **Server:** `requirePlanV3(request, minPlan)` (`app/services/require-plan.server.ts`)
  — enforces the ladder and redirects to `/app/settings?upgrade=<plan>` when the
  shop's effective plan is below `minPlan`. `getShopCapabilities(shop)` returns the
  capability object for loaders/UI.
- **UI:** locked features render **disabled + upgrade-labeled** (never
  clickable-then-error) — a Global rule and a Built-for-Shopify design rule.

## Files

- `app/lib/billing-v3.ts` — pure ladder, pricing, capability map, grandfathering.
- `app/services/billing.server.ts` — `PLAN_V3_ENABLED`, `ACTIVE_BILLING_CONFIG`
  (legacy + v3), `resolveV3PlanFromName`, v3 reconcile, `getShopCapabilities`.
- `app/services/require-plan.server.ts` — `requirePlanV3`.
- Migration `pricing_v3` — enum `FREE`/`SCALE`, `Shop.legacyPlan` + `legacyPriceCents`.

## Trust message

"No per-order fees, ever — one flat monthly price." Surfaced on the in-app plan
screen (`app.settings`) and the pricing page. Mannon is a flat monthly fee, never a
per-order commission — deliberately unlike the Make-an-Offer rivals that draw 1★
reviews for opaque per-order cuts.

## Rollout

The flag is off. When ready: set `MANNON_FF_PLAN_V3=true`, run the `pricing_v3`
migration, and verify grandfathering on a store that already has a legacy sub
(its price must not change; its capabilities map up). The plan-picker UI (4-plan
selection) is the next slice; PR-1 ships the billing engine, capability map,
grandfathering, gate, and copy.
