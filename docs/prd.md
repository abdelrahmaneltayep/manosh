# /docs/prd.md — Mannon PRD

## 1. Problem

Non-Plus Shopify merchants who turn on **native B2B** immediately hit two walls: the 3-catalog cap
and the fact that everything past a catalog — quotes, custom pricing per account, reorders — falls
back to **email + spreadsheets**. Heavyweight suites (SparkLayer, BSS) exist but are priced and
scoped for enterprise, not SMB.

## 2. Thesis

Ride Shopify's native B2B (companies, catalogs, payment terms) and price on **draft orders**. Give
the merchant a quote inbox and the buyer a passwordless portal for quoting + one-tap reorder. Don't
rebuild pricing, tax, or terms — orchestrate what Shopify already does. Buildable in a week because
of that discipline.

## 3. Features

### F1 — Quote loop (core)

The heart of the app. A buyer builds a basket in the portal and submits a quote; the merchant
counters from a Polaris inbox; the buyer accepts; acceptance creates a real Shopify **draft order**
with real totals.

**Quote status machine** (implemented as a pure, UI-free service — S5):

```
SUBMITTED ──counter──▶ COUNTERED ──accept──▶ ACCEPTED ──order──▶ ORDERED
    │                      │                      │
    └──────────── expire (14d default) ───────────┴──▶ EXPIRED
```

Rules:
- Default expiry **14 days** (merchant-configurable via `Shop.quoteExpiryDays`).
- **Illegal transitions throw.** Only the arrows above are allowed. e.g. you cannot accept a
  `SUBMITTED` quote (it must be `COUNTERED` first), you cannot re-open an `EXPIRED` or `ORDERED`
  quote.
- **Expiry auto-flips** on read and via cron: any non-terminal quote past `expiresAt` becomes
  `EXPIRED`.
- **Every transition appends an `Event`** (`QUOTE_SUBMITTED`, `QUOTE_COUNTERED`, `QUOTE_ACCEPTED`,
  `QUOTE_ORDERED`, `QUOTE_EXPIRED`).

Surfaces:
- **Merchant Quote Inbox** (S6): Polaris `IndexTable` with status badges; detail view to edit line
  prices/quantities and send a counter; designed empty state ("No quotes yet — send your buyers a
  link"); keyboard-navigable.
- **Buyer quote builder** (S7): in `/portal`, build a basket from the merchant catalog and submit;
  creates a `Quote` in `SUBMITTED`; mobile-first; catalog reads cached.
- **Accept → draft order** (S8): on buyer accept of a counter, call `draftOrderCreate` with the
  correct `purchasingEntity` (company + location + contact) and preview real totals with
  `draftOrderCalculate`. Save `draftOrderId` + `totalsSnapshot`; move `ACCEPTED → ORDERED`. **We
  never compute tax/discounts ourselves.**

### F2 — One-click reorder (the revenue feature)

In the portal, list the company's past orders as **reorder cards** (order #, date, total). One tap
clones the line items into a new draft order the buyer can adjust and submit. A merchant setting
`autoApproveTolerance`: within tolerance → auto-convert; outside → merchant approves. Mobile-first —
buyers reorder from their phone. Appends `REORDER_CREATED`.

### F3 — Quick-order pad

A SKU/quantity grid for buyers who know what they want. Type or paste `SKU + qty` rows; rows resolve
against the catalog into a cart. **Unknown SKUs are flagged inline, never silently dropped.**
Accessible grid (keyboard + labels). This is the deterministic base that AI-1 (F/AI-1) sits on top
of.

### F4 — Net-terms-lite + PO reference

Surface the store's **native** B2B payment terms (net 7–90 + due-on-fulfillment) on the quote and
reorder views, plus a **PO reference** field saved onto the draft order. **Display + attach only** —
no parallel terms engine; Shopify enforces terms.

### F5 — ROI dashboard ("Mannon made you $X")

Merchant home, built **entirely from the Event stream** (no new writes): quotes sent/accepted,
reorders, revenue attributed, median time-to-quote, quotes expiring soon — with one big **"revenue
made for you"** headline number. Designed empty state before any activity. p95 < 500ms.

### F6 — Compliance (pass/fail for review)

The mandatory trust layer: 3 GDPR webhooks, `app/uninstalled` cleanup, HMAC on every webhook,
minimum scopes. Full spec in `/docs/compliance.md`.

### AI-1 — Magic Order Pad

Paste a PO/email/spreadsheet → Claude Haiku resolves it to catalog lines → confirm screen → cart.
Sits on the F3 pad. Full spec in `/docs/ai-spec.md`. **AI never acts autonomously** — cart is built
only on explicit confirm; every returned `variant_id` is validated against the live catalog.

## 3.5 Data model

See `/docs/data-model.md` for the exact Prisma schema.

## 3.7 Pricing

- **14-day free trial**, then choose a plan.
- **Starter — $29/mo**: quote loop (F1), reorder (F2), quick-order pad (F3), terms/PO (F4),
  dashboard (F5), AI Magic Order Pad (AI-1).
- **Growth — $79/mo**: everything in Starter **plus** Growth-only features — Quote Copilot and
  Reorder Radar hooks — gated behind the active plan via `requireBilling()`.
- Recurring charges via the Shopify **Billing API**. Handle upgrade, downgrade, and cancel. Gating is
  stubbed in S3 and completed in S17.

Rationale: incumbents charge $150–300/mo real; a flat $29 that removes the email grind is an easy
yes. See S0 validation.

## 4. Non-goals (v1)

- No custom pricing/tax/terms engine (Shopify owns these).
- No standalone (non-embedded) merchant UI — the admin app is embedded; only the **buyer portal** is
  non-embedded.
- No autonomous AI actions.

## 5. Metrics

AARRR funnel instrumented from day one (PostHog). See `/docs/metrics.md` (created in S14):
Acquisition (install) · Activation (first quote sent, first reorder) · Retention (returning
merchant) · Revenue (trial→paid) · Referral (review prompt).
