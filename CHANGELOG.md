# Changelog

All notable changes to Mannon are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Dates are UTC.

## [Unreleased]

### Added — Feature 3: Customer-Specific Price Lists & Volume Pricing

- **Price lists.** Named per-variant price lists assigned to a company directly or
  by Shopify customer tag (auto-apply on signup). Buyers see their price with no
  discount codes, plus a **"you save X%"** badge in the portal quote builder.
- **Volume breaks (Growth).** Quantity-break pricing per variant.
- **Price resolver.** Pure, hard-tested precedence: **volume break > list entry >
  default** (`app/lib/price-resolver.ts`), used identically server-side and in the
  portal.
- **Bulk editor + CSV.** Polaris `IndexTable` editor; CSV export + blank template
  on any plan; **CSV import is Growth-only**, with a per-line validation summary.
- **Plan gating.** Starter = up to **3** price lists, no volume breaks, no CSV
  import. Growth = unlimited lists + volume breaks + CSV. The 4th list on Starter
  is blocked with an upgrade CTA (`PLAN_LIMITS.priceListCap`). Dark-launched behind
  `MANNON_FF_PRICELISTS`.
- Event: `PRICELIST_ASSIGNED` (append-only). Migration: `f3_price_lists`.

### Added — Feature 2: Net Terms + Credit Management

- **Invoices on net-terms checkout.** When an accepted quote becomes a draft
  order, Mannon raises an `Invoice` with `dueDate = issuedAt + termsDays` (from
  the company's credit profile, else the shop default). Idempotent by order id.
- **Credit profiles + credit check (Growth).** Per-company credit limit, terms
  (7/15/30/45/60/90), and active/hold status. A net-terms order that would push
  a company over its limit — or a company on hold — is **blocked before the draft
  order is created**; the merchant lifts it by raising the limit or clearing the
  hold (logged as `CREDIT_OVERRIDE`).
- **Aging dashboard (Growth).** Current / 1–30 / 31–60 / 60+ buckets with
  per-company outstanding balances, on the new **Credit** page.
- **Automatic reminders (Growth).** A secret-protected cron route
  (`/internal/cron/reminders`) sends T-3 / due / +7-overdue reminders, idempotent
  per invoice+stage. Templates are editable in Settings.
- **Buyer invoices.** The portal lists open invoices with due dates and a
  printable invoice page ("Download PDF" via the browser).
- **Plan gating.** Starter = net terms + due dates. Growth = credit limits, aging,
  reminders, and PDFs. Dark-launched behind `MANNON_FF_CREDIT`.
- Events: `INVOICE_CREATED`, `REMINDER_SENT`, `CREDIT_OVERRIDE` (append-only).
- Migration: `f2_net_terms_credit`.

### Added — Feature 1: AI Quote Assistant (Growth)

- **AI counter-offers inside a quote.** On an open (SUBMITTED) quote, merchants
  can click **AI suggest** on a line — or **Suggest counter-offer for all lines** —
  to get a suggested unit price, a margin/risk read, and a ready-to-send buyer
  message. Accept prefills the counter field; Edit and Dismiss are one click away.
- **Floor-margin guardrail.** A new per-shop setting, **AI floor margin**
  (default 15%), sets the lowest margin the assistant will knowingly propose. Any
  suggestion that breaches it is flagged in red and can't be accepted in one
  click. The floor is enforced in pure, unit-tested code — never trusted to the
  model.
- **Real margins.** Wholesale cost is read from Shopify
  (`ProductVariant.inventoryItem.unitCost`, new `read_inventory` scope) and cached
  per variant (`VariantCost`).
- **Plan gating.** The assistant is **Growth-only**
  (`requirePlan(billing, GROWTH_PLAN)` on the action, `featureAccess` in the UI).
  Starter merchants see a locked upsell. The public `/pricing` page and in-app
  Plans matrix show the Growth badge.
- **Guardrails.** Temperature 0, forced tool call, no autonomous action — AI
  drafts, a human confirms (guardrail #4). Every suggestion appends an
  append-only `AI_SUGGESTION_USED` event (ids + numbers only, no PII).
- **Dark launch.** Gated behind the `MANNON_FF_AI_QUOTE` feature flag.

### Notes

- Migration: `f1_ai_quote_assistant` (adds `Shop.minMarginPct`, `VariantCost`,
  `QuoteAiSuggestion`, and the `AI_SUGGESTION_USED` event type).
