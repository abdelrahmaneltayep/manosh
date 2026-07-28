# Changelog

All notable changes to Mannon are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Dates are UTC.

## [Unreleased]

### Added — Feature 13: Flexible Payments — Deposits, Partial Pay & Pay-by-Link (Growth)

- **Beyond net terms.** On an accepted order the merchant picks **deposit +
  balance**, an **installment schedule**, or a one-off **pay-by-link**. Amounts are
  **server-authoritative** — computed in `app/lib/payments.ts` from the order's
  stored totals snapshot in integer cents, so deposit + installments always sum to
  the exact total (rounding remainder lands on the last line).
- **Pay-by-link.** A tokenized, single-use, expiring link for a specific amount.
  Only the token **hash** is stored (guardrail #7); no amount/PII is ever put in
  the URL beyond the opaque token. The public `/pay/:token` page shows the amount
  and hands off to Shopify checkout.
- **No card data — ever.** All capture runs through Shopify checkout / draft
  orders; Mannon never stores or sees a card. Documented in
  `docs/flexible-payments.md`.
- **Chases itself + reconciles.** `/internal/cron/payment-reminders` (CRON_SECRET)
  flips overdue installments and sends due/overdue reminders (idempotent per
  installment+stage, reusing the F8 mailer conventions). A completed plan marks the
  net-terms invoice paid and (if F10 is on) triggers an accounting sync. Merchant
  **overdue filter** on `/app/payments`.
- **Plan gating.** Growth-only (`flexPayAllowed`); Starter sees "Deposits & payment
  plans — upgrade to Growth." New Shop setting `defaultDepositPct` (optional
  onboarding). Events `PAYMENT_PLAN_CREATED`, `INSTALLMENT_PAID`, `PAYLINK_PAID`.
  New templates: deposit received / installment due / installment overdue /
  pay-link. Dark-launched behind `MANNON_FF_FLEX_PAY`. Migration
  `f13_flexible_payments`.

### Added — Feature 12: Sales-Rep Portal (Order-on-Behalf & Assigned Accounts) (Growth)

- **Reps sell through Mannon.** A `SalesRep` signs in via the same passwordless
  magic-link mechanism as buyers (token hashed at rest) to a scoped `/rep` portal
  that shows **only** their assigned companies (`RepAssignment`). Strict isolation:
  every read is scoped, and `getRepCompany` returns null (→ 404) for an unassigned
  company (`repCanAccessCompany` is the single source of truth).
- **Order on behalf.** A rep picks a buyer, enters an impersonation context
  (clearly banner-marked "Ordering on behalf of {buyer} · {company}"), and places
  a quote/order that stays the buyer's but is attributed to the rep
  (`Quote.placedByRepId`). Buyer limits still apply (F9 MOQ, F5 approvals, F3
  price list, F11 visibility). Every on-behalf order logs
  `ORDER_PLACED_ON_BEHALF` (rep + buyer ids) and emails the buyer a transparency
  notice.
- **Merchant admin** at `/app/reps`: invite reps (magic link), assign companies,
  and a **rep leaderboard** (quotes / orders / win rate) derived from attributed
  quotes.
- **Plan gating.** Growth-only (`repPortalAllowed`, `PLAN_LIMITS.repSeatCap` = 0
  Starter / 3 Growth). Starter sees "Add your sales team — upgrade to Growth."
  Events `REP_INVITED`, `ORDER_PLACED_ON_BEHALF`. New editable templates
  `rep_invite`, `rep_order_placed`. Dark-launched behind `MANNON_FF_REP_PORTAL`.
  Migration `f12_sales_rep_portal`. Optional first-run nudge in Settings. See
  `docs/sales-rep-portal.md` for the isolation + impersonation-audit guarantees.

### Added — Feature 11: Custom Catalogs & Per-Customer Product Visibility

- **See only your products.** A `Catalog` (visibility `ASSIGNED` = deny-by-default
  / `ALL` = everything-but-hidden) is resolved for each buyer by precedence:
  **member > company > group (customer tag) > store default**. Assigned via
  `CatalogAssignment`, built from `CatalogItem` include/exclude rows or CSV.
- **One enforcement point, no leaks.** The portal, order pad (F4), reorder, and
  quote builder all read products through `getVisibleCatalog`, so a hidden SKU is
  **removed, never greyed** — and can't leak via the list, a direct/submitted
  variant id, or the quote line-item picker. Resolution is cached per buyer.
- **Merchant builder** at `/app/catalogs`: create catalogs, check products in/out,
  assign to company/group/member, CSV import (Growth), and a **"preview as
  customer"** split view that matches exactly what the buyer sees.
- **Plan gating.** Starter = 1 custom catalog, company-level assignment;
  Growth = unlimited catalogs + group/member assignment + CSV
  (`PLAN_LIMITS.customCatalogCap`, `catalogAssignmentScopes`, `catalogCsvAllowed`).
  Event `CATALOG_ASSIGNED`. Dark-launched behind `MANNON_FF_CUSTOM_CATALOGS`.
  Migration `f11_custom_catalogs`. Optional first-run nudge in Settings. See
  `docs/custom-catalogs.md` for the visibility-leak guarantees.

### Added — Feature 10: Accounting Sync (QuickBooks Online & Xero) (Growth)

- **Books, no re-keying.** Connect QuickBooks Online or Xero via OAuth (standard
  redirect — no pasted secrets) and every Mannon net-terms invoice, plus its
  payment when settled, syncs to the provider automatically. Tokens are
  **AES-256-GCM encrypted at rest** (`app/lib/crypto.server.ts`) and never logged.
- **Idempotent + self-healing.** Each invoice is queued once per provider (DB
  unique on shop+provider+entity+localId — a retry or double-checkout never
  double-posts), synced by `/internal/cron/accounting` (CRON_SECRET) with capped
  exponential backoff, and parked as **FAILED** with a **Retry** button after
  `SYNC_MAX_ATTEMPTS`. A failed sync never blocks the Shopify order.
- **Field mapping.** Map Mannon tax classes → provider tax codes and a default
  income account, choose customer match strategy (email / name), and a sandbox
  test-mode toggle — at `/app/accounting`.
- **Failure digest.** One merchant email (not per-event spam) summarizes
  undigested failures; new editable template `accounting_sync_failure`.
- **Plan gating.** Growth-only (`accountingSyncAllowed`); Starter sees "Connect
  your accounting — upgrade to Growth." Optional first-run nudge in Settings.
  Events `ACCOUNTING_CONNECTED`, `INVOICE_SYNCED`. Dark-launched behind
  `MANNON_FF_ACCOUNTING_SYNC`. Migration `f10_accounting_sync`. No new Shopify
  OAuth scope (QBO/Xero are external OAuth). See `docs/accounting-sync.md`.

### Added — Feature 9: MOQ, Order Minimums & Pack/Case-Size Rules

- **Wholesale order controls.** Minimum order quantity (MOQ), order-value
  minimums, and pack/case-size multiples via `OrderRule`, resolved by specificity
  (product > customer-group > collection > store; most-specific wins).
- **One resolver, three surfaces.** The pure `app/lib/order-rules.ts` enforces
  identically in the **portal cart / order pad**, the **F4 order pad** display
  (live rounding hints + minimum-order progress bar), and **quote → order
  conversion**. Quantities round **up** and are never silently dropped — every
  change is explained ("sold in cases of 12 — rounded to 24"). A cart under the
  store minimum is blocked with an "add $X more" shortfall.
- **Merchant editor** at `/app/order-rules`: rule table, a live **"test this
  cart"** preview, and CSV bulk import (Growth).
- **Plan gating.** Both plans; Starter = store + product scope; Growth adds
  collection + customer-group scopes, pack multiples, and CSV
  (`allowedRuleScopes` / `packRulesAllowed`). Event `ORDER_RULE_APPLIED`. Dark-
  launched behind `MANNON_FF_MOQ`. Migration `f9_moq_rules`.

### Added — Feature 8: Automated Quote Follow-ups, Expiry & Reminders

- **Stop quotes going cold.** A store follow-up policy (expiry days + nudge
  cadence + max nudges) schedules per-quote reminders, an expiry warning, and the
  expiry itself. Each buyer email carries accept/counter deep-links.
- **Self-healing scheduler.** `/internal/cron/followups` (CRON_SECRET) reconciles
  schedules (schedule active quotes, cancel terminal ones) then dispatches due
  nudges and runs expiries via the existing status machine (`expireQuote`).
- **Guardrails.** Never exceeds `maxNudges`; respects buyer **unsubscribe** (signed
  email link → `/portal/unsubscribe/:id`); **quiet-hours-safe** (Mon–Fri 9–18 in
  `Shop.timezone`). Accepting a quote cancels the remaining nudges.
- **Merchant control.** A "needs a nudge" list with **Send now**, and the policy
  editor at `/app/followups`.
- **Plan gating.** Starter = expiry + a single reminder; Growth = full auto-cadence
  + multi-nudge (`PLAN_LIMITS.followupCadenceMax`). Emails (reminder /
  expiry-warning / expired) are editable in Settings. Events `FOLLOWUP_SENT`,
  `QUOTE_EXPIRED`. Dark-launched behind `MANNON_FF_FOLLOWUPS`. Migration
  `f8_quote_followups`.

### Added — Feature 7: Quote Analytics & Sales Dashboard (Growth)

- **Negotiation analytics** at `/app/analytics`: win rate, average discount,
  time-to-close, and open pipeline as KPI cards with trend sparklines and a 30/90-
  day switcher — plus top accounts, a most-discounted-SKU leaderboard, and stale
  quotes needing action. All money is in one store currency (never mixed).
- **Derived, not duplicated.** Metrics come from existing `Quote` data; discount
  is measured against the customer's F3 price list. A `QuoteMetricDaily` rollup +
  `/internal/cron/analytics` (CRON_SECRET) build daily rows and, on Mondays, send
  the opt-in **weekly digest** (`Shop.weeklyDigest`, `weekly_digest` template).
- **CSV export** of the underlying quotes; empty state before {MIN} quotes.
- **Plan gating.** Growth-only — Starter sees a locked, blurred preview with an
  upgrade CTA. Event `ANALYTICS_VIEWED`. Dark-launched behind
  `MANNON_FF_QUOTE_ANALYTICS`. Migration `f7_quote_analytics`.

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
