# Feature 13 — Flexible Payments (Deposits, Partial Pay & Pay-by-Link)

Beyond net terms (F2): take a deposit up front, split a large order into
installments, or send a secure pay-by-link. Growth-only, dark-launched behind
`MANNON_FF_FLEX_PAY`.

## The hard guarantee — no card data, ever

**Mannon never stores, sees, or accepts card details.** This feature only:

1. Computes **server-authoritative amounts** (`app/lib/payments.ts`) from the
   order's stored totals snapshot, and
2. Orchestrates **Shopify-hosted capture** — the deposit runs through the
   draft-order / checkout, and a pay-link redeems against a Shopify-hosted
   payment.

There is no code path in this feature that renders, receives, or persists a card
number, CVV, or PAN. The `/pay/:token` page hands the buyer off to Shopify
checkout.

## Plan availability

Growth only. Starter sees "Deposits & payment plans — upgrade to Growth." Gated
by `flexPayAllowed(plan)` (`app/lib/billing.ts`) on plan creation, pay-link
issuance, and the pay-plan pages.

## Server-authoritative money (the core)

`app/lib/payments.ts` is pure and unit-tested. All math is in **integer cents**
(never floats):

- `computeDeposit(total, pct)` → `{ deposit, balance }` that sum to the total.
- `buildSchedule(input)` → the deposit (installment #0, due now) + the balance
  split into N equal installments, **rounding remainder on the last line**, dates
  spaced by `intervalDays`. Amounts always sum to the exact total.
- `planStatus` / `installmentStatus` — derive live ACTIVE / OVERDUE / COMPLETED.
- `payLinkRedeemable` — single-use + expiry gate.

Amounts for a plan and a pay-link are **always derived server-side** from the
order total / installment — never taken from the client.

## Pay-by-link

Tokenized, single-use, expiring. A 256-bit token is generated; only its **hash**
is stored on `PayLink` (guardrail #7). The raw token exists only in the emailed
URL (`/pay/:token`). No amount or PII is placed in the URL. Redemption is an
atomic conditional update (a replay loses the race). `PAYLINK_PAID` is logged.

## Reminders + reconciliation

`/internal/cron/payment-reminders` (CRON_SECRET, daily) per shop:

- Flips overdue installments and plans.
- Sends **due** (T-3) and **overdue** reminder emails, idempotent per
  installment+stage (tracked in `PaymentInstallment.reminderStages`), reusing the
  F8 mailer conventions (unsubscribe + quiet hours).

When a plan reaches COMPLETED, `reconcileOrderPaid` marks the order's net-terms
invoice (F2) paid and, if `MANNON_FF_ACCOUNTING_SYNC` is on, enqueues an F10
accounting sync.

## Data model (migration `f13_flexible_payments`)

- `PaymentPlan { type, depositPct?, schedule?, totalAmount, currency, status }` — one per accepted quote (the "order").
- `PaymentInstallment { sortOrder, label?, amount, dueDate, paidAt?, status, reminderStages? }`.
- `PayLink { tokenHash (unique), amount, currency, expiresAt, usedAt?, status }`.
- `Shop.defaultDepositPct` (optional default policy).
- Events `PAYMENT_PLAN_CREATED`, `INSTALLMENT_PAID`, `PAYLINK_PAID`.

## Reconciliation / notes

- The prompt's `PaymentPlan.orderId` / `PayLink.orderId` map to **`quoteId`** —
  Mannon orders are Shopify draft orders created from an accepted quote, so the
  quote is the durable order record (its `draftOrderId` links to Shopify).
- `PayLink.token` is stored as `tokenHash` (hashed at rest) per guardrail #7 — the
  prompt's "opaque token, no PII in query params" is honored.
- In the container (no store/checkout), redeeming a pay-link settles the
  installment directly; in production the redeem completes **after** Shopify-hosted
  capture. The wiring point is `markInstallmentPaid` (also callable from an
  `orders/paid` webhook for the deposit checkout).
- No new Shopify OAuth scope.
