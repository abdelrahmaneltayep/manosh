# Changelog

All notable changes to Mannon are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Dates are UTC.

## [Unreleased]

### Added — Feature 6: Wholesale Registration + Gated Approval

- **Branded application funnel.** A merchant builds a wholesale form in admin
  (custom fields, types, required flags); a public URL `/apply/:shop` renders it
  with no login — a honeypot, per-key rate limit, and email dedupe guard it.
- **Approval queue.** Approve / reject / request-more-info from the admin queue.
  On approve, Mannon provisions an F5 **Company** + admin member with a
  passwordless magic link, assigns the F3 **default price list**, tags the
  application `b2b-approved`, and best-effort tags the Shopify customer (new
  `write_customers` scope). Trade pricing stays gated until approval.
- **Auto-approval (Growth).** Applications from allowlisted email domains approve
  automatically.
- **Plan gating.** Both plans; `PLAN_LIMITS.wholesaleFormCap` = 1 (Starter) /
  unlimited (Growth). Multiple forms, file-upload fields, and auto-approval rules
  are Growth-only. The 2nd form on Starter is blocked with an upgrade CTA.
- **Emails.** New editable templates: application received, decision, internal
  notify. Event `WHOLESALE_APPLICATION_DECIDED`. Dark-launched behind
  `MANNON_FF_WHOLESALE_REG`. Migration `f6_wholesale_registration`.

### Added — Feature 5: Company Accounts & Multi-Buyer Sub-Accounts

- **Members with roles.** A buyer is now a company member with a role (admin /
  buyer / approver) and status (invited / active). Admins invite teammates from a
  new portal **Team** tab using the existing passwordless magic-link — no new
  passwords. Extends `Buyer` rather than forking a parallel identity table.
- **Seat cap.** `PLAN_LIMITS.memberCap` = 1 (Starter) / 5 (Growth). The 2nd invite
  and the approver/admin roles are blocked on Starter with an upgrade CTA.
- **Spending approvals (Growth).** Set `Company.approvalThreshold`; a quote whose
  estimated total reaches it can't be placed until an approver approves. The accept
  action creates a pending `OrderApproval`, emails approvers (approve/reject
  deep-link), and blocks the order; approve unblocks it, reject stops it.
- **Emails.** New editable templates: member invite, approval request, approval
  decision.
- **Events.** `MEMBER_INVITED`, `ORDER_APPROVED` (append-only). Dark-launched
  behind `MANNON_FF_COMPANY_ACCOUNTS`. Migration `f5_company_accounts` (backfills
  the earliest buyer per company to ADMIN).

### Added — Feature 4: Enhanced Quick Order / Bulk Order Pad

- **Keyboard-first order pad** in the buyer portal: type-ahead SKU/product search
  (Enter adds the row and refocuses), paste `SKU,QTY` lines with per-line error
  flags, and a **live subtotal** priced with the Feature 3 resolver (volume break
  > list entry > default).
- **Saved lists.** "Save as list" and one-tap **Reorder** (deep-linkable via
  `?list=<id>`, e.g. from a reorder email). Capped per plan
  (`PLAN_LIMITS.savedListCap` = 3 Starter / ∞ Growth).
- **CSV upload (Growth).** Paste a `sku,qty` CSV with a per-line validation summary;
  gated with the Growth plan check. Starter keeps search + paste + 3 saved lists.
- The order pad is now the buyer portal's primary CTA, with first-order coaching.
- Pure parser + resolver relocated to `app/lib/quick-order.ts` (client-safe) so the
  pad parses + prices without a round-trip. Event `ORDERPAD_USED`. Dark-launched
  behind `MANNON_FF_ORDERPAD`. Migration: `f4_quick_order_pad`.

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
