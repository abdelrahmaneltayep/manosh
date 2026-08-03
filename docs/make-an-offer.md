# F21 — Make an Offer / Name Your Price (PR-3 core)

Let buyers name their price; the merchant counters, accepts, or declines — with a
**margin-safe rule engine**. Growth = manual + rules; Scale = automation + PWYW.
Dark-launched behind `MANNON_FF_MAKE_AN_OFFER`; gated growth+ via the PR-1
capability map (`makeAnOffer` tier, `offerRuleCap`).

**PR-3 scope (§2.1–2.4):** models + migration, the rule engine, the manual admin
flow (queue, detail + thread + counter/accept/decline), rules editor, widget
config. **PR-4** adds the storefront theme-app-extension surfaces, the Scale
auto-execution + PWYW, and offer→net-terms/deposit conversion.

## The rule engine (`app/lib/offers.ts`) — pure, tested

Reuses the **F1 margin idea** against the variant-cost baseline (`getVariantCost`)
— no second pricing brain. Decision order (§2.2):

1. **auto-decline** — offered below `autoDeclineBelowPctOfList`
2. **auto-accept** — offered at/above `minAcceptPctOfList` **and** margin ≥ `marginFloorPct`
3. **auto-counter** — to `autoCounterToPctOfList`, **clamped up to the floor price**
4. **manual** — otherwise

**The invariant (§2.5): the margin floor always wins.** The engine never
auto-accepts or auto-counters below `marginFloorPct`; when it can't stay above the
floor automatically it falls back to manual. When any line's cost is unknown, the
suggestion is forced to manual (never commit blind). Covered by `offers.test.ts`
(incl. explicit floor-never-breached cases).

## Data model (migration `make_an_offer`)

`Offer` (status PENDING→COUNTERED/ACCEPTED/DECLINED/EXPIRED/CONVERTED, Decimal
totals, `marginAtOffer`, `ruleId`, `handledBy`) · `OfferMessage` (negotiation
thread: BUYER/MERCHANT/SYSTEM) · `OfferRule` (thresholds + margin floor + priority)
· `OfferWidgetConfig` (surfaces + button label). All FK'd to `Shop` with
`onDelete: Cascade` (so shop/redact erases them). Events: `OFFER_CREATED`,
`OFFER_COUNTERED`, `OFFER_ACCEPTED`, `OFFER_DECLINED`, `OFFER_CONVERTED`,
`OFFER_RULE_UPDATED`.

## Admin (`/app/offers`)

- **Queue** — Polaris IndexTable; buyer, source, list/offer, margin, status.
- **Detail** (`/app/offers/:id`) — economics, the engine's **suggestion** banner,
  the negotiation thread, and counter / accept / decline (manual).
- **Rules** (`/app/offers/rules`) — create/list/delete, cap-aware (Growth 3 / Scale
  ∞), with the margin floor front and center.
- **Widget** (`/app/offers/widget`) — surfaces config; button + inline form on
  Growth, banner + exit popup added on Scale (disabled + labeled below Scale).

## Gating (§1.3)

`getShopCapabilities(shop).makeAnOffer`: `teaser` (free/starter) → the Offers admin
shows an upgrade CTA (locked, not clickable-then-error); `manual` (growth) → rules
guide manual decisions, up to `offerRuleCap` (3); `auto` (scale) → automation + PWYW
+ conversion (PR-4). Money is always Shopify's — accepting converts to a draft
order/net-terms/deposit (PR-4), never computed here.
