# Feature 2 — Net Terms + Credit Management

Give each company a credit profile (limit + terms + status), raise invoices on
net-terms checkout, chase payment automatically, and show an aging view.

## Plan availability

| Capability | Starter | Growth |
|---|---|---|
| Net terms + invoice due dates | ✓ | ✓ |
| Credit limits + credit check | — | ✓ |
| Aging dashboard | — | ✓ |
| Automatic reminders (T-3 / due / +7) | — | ✓ |
| Invoice PDFs (buyer) | — | ✓ |

Growth gating is enforced with `requireBilling` + `featureAccess(status, GROWTH_PLAN)`
on the `/app/credit` loader/action and the reminder cron. Dark-launched behind the
`MANNON_FF_CREDIT` flag.

## Data model (migration `f2_net_terms_credit`)

- `CreditProfile` — one per company: `creditLimit` (0 = no limit), `termsDays`
  (7/15/30/45/60/90), `status` (ACTIVE|HOLD).
- `Invoice` — `amount`+`currency` snapshot, `dueDate`, `status`
  (OPEN|PAID|OVERDUE|VOID), optional `quoteId`/`orderId`.
- `PaymentReminder` — one row per `(invoiceId, kind)`; the unique constraint makes
  the reminder job idempotent.
- `Shop.defaultTermsDays`, `Shop.emailTemplates` (JSON overrides).
- Events: `INVOICE_CREATED`, `REMINDER_SENT`, `CREDIT_OVERRIDE`.

## Flows

**Invoice on checkout.** `acceptAndOrder` (`quote-accept.server.ts`), after the
draft order is created, calls `createInvoiceForOrder` with
`dueDate = now + termsDays`. Idempotent by order id.

**Credit check.** Before creating the draft order, `evaluateCredit` (pure) blocks
when `outstanding + newOrder > creditLimit` or the company is on HOLD, throwing
`CreditBlockedError`. Buyers see "needs approval"; the merchant overrides by
raising the limit / clearing the hold on the Credit page (logged `CREDIT_OVERRIDE`,
numbers-only payload).

**Aging.** `getAgingReport` buckets OPEN/OVERDUE invoices into Current / 1–30 /
31–60 / 60+ (`app/lib/aging.ts`, pure + tested).

**Reminders.** `stageFor` (pure) picks T-3 / DUE / +7 for an invoice at `now`.
`runRemindersForShop` records a `PaymentReminder` (idempotent) then best-effort
sends the email and appends `REMINDER_SENT`.

## Scheduling the reminder job

`/internal/cron/reminders` is a resource route (POST or GET) protected by
`CRON_SECRET` (not a Shopify webhook — no HMAC). Run it once daily:

```
curl -X POST https://manosh.fly.dev/internal/cron/reminders \
  -H "x-cron-secret: $CRON_SECRET"
```

Options: a Fly Machines scheduled machine, a GitHub Action `schedule:`, or the
claude-code-remote Routines. It flips overdue invoices for all shops, then sends
reminders for Growth shops only.

## Email delivery

Mannon had no mailer before F2. `app/services/mailer.server.ts` is a small,
non-throwing abstraction that **no-ops until a transport + `MANNON_MAIL_FROM` are
configured** (mirrors the analytics/Sentry pattern). The reminder pipeline and
`PaymentReminder` records work end-to-end around it; wire SMTP/Resend/SendGrid in
`sendEmail()` when ready. Templates (invoice issued + three reminders) are editable
in Settings and stored on `Shop.emailTemplates`.

## Invoice PDF

The buyer's printable invoice (`/portal/invoices/:id`) uses the browser's
print-to-PDF (`window.print()`) with print CSS — no PDF dependency shipped. Swap in
a server-side PDF (e.g. pdfkit) later if an email attachment is needed.
