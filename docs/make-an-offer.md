# F21 — Make an Offer / Name Your Price (PR-3 core + PR-4 storefront/automation)

Let buyers name their price; the merchant counters, accepts, or declines — with a
**margin-safe rule engine**. Growth = manual + rules; Scale = automation + PWYW.
Dark-launched behind `MANNON_FF_MAKE_AN_OFFER`; gated growth+ via the PR-1
capability map (`makeAnOffer` tier, `offerRuleCap`).

**PR-3 scope (§2.1–2.4):** models + migration, the rule engine, the manual admin
flow (queue, detail + thread + counter/accept/decline), rules editor, widget
config. **PR-4 (§2.2 scale path + §2.3):** the storefront theme-app-extension,
Scale auto-execution + PWYW, and offer → native draft order conversion.

## Storefront (theme app extension `extensions/make-an-offer/`)

Mirrors F17's Request-a-Quote block. The merchant adds the **Make an Offer** app
block from the theme editor (no theme-code editing). It loads **async** (never
blocks the storefront), reads `GET /api/offer-config?shop=` to decide whether and
how to render (off below Growth; banner/exit-popup surfaces are Scale-only), and
posts to `POST /api/offer`. Anti-spam mirrors F17: a hidden honeypot
(`company_url_confirm`) + a render→submit timer + a per-ip/shop rate limit — spam
gets a **generic OK** so bots learn nothing. On Scale the buyer sees an instant
answer (accepted / countered / declined); on Growth it's "we'll reply by email".

## Automation + PWYW (`resolveAutoOutcome`, Scale only)

On Growth every offer stays **pending** for the merchant. On Scale the engine's
decision runs automatically — auto-decline / auto-accept / auto-counter — and a
**manual** decision becomes **Pay-What-You-Want**: auto-accept iff the offered
margin clears the shop's PWYW floor (`Shop.minMarginPct`, the F1 floor), else it
falls to the merchant. The margin floor is never breached: accept only fires when
margin is verified safe, and a **cost we don't know forces manual** (never commit
blind).

## Conversion (`convertOffer`, §2.3) — offer → native draft order

An accepted offer converts to a **Shopify draft order** on the buyer's B2B company
location (net-terms / deposit path), exactly like quote → order (S8): the agreed
total is split across lines as agreed **per-unit prices** (`agreedUnitPriceCents`,
a uniform "% off"), and **Shopify calculates tax + the real total** — we never
compute money (guardrail #1). Order of operations mirrors S8: **Shopify first,
then flip the offer to `CONVERTED`** (+ `convertedOrderId`, `OFFER_CONVERTED`
event), so a Shopify failure never strands the offer. A buyer not linked to a
company location can't convert (same rule as quotes).

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
