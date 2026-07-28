# Feature 10 — Accounting Sync (QuickBooks Online & Xero)

Push Mannon net-terms invoices (and their payments) into the merchant's
accounting provider with zero re-keying. Growth-only, dark-launched behind
`MANNON_FF_ACCOUNTING_SYNC`.

## Plan availability

Growth only. Starter sees "Connect your accounting — upgrade to Growth."
Gated by `accountingSyncAllowed(plan)` (`app/lib/billing.ts`) on the settings
page, the OAuth start route, and every sync job.

## How it flows

1. **Connect** — the merchant clicks Connect on `/app/accounting`. The start
   route (`app.accounting-connect.$provider`) builds the provider authorize URL
   with a **signed `state`** carrying the shop identity, and top-level redirects
   (breaks out of the embedded iframe).
2. **Callback** — the provider redirects to the public
   `/accounting/callback/:provider`. It has no Shopify session, so trust comes
   from verifying the signed `state` (HMAC with the app secret, 10-min freshness).
   It exchanges the code for tokens and stores them **encrypted**.
3. **Enqueue** — when a net-terms order raises an invoice
   (`createInvoiceForOrder`), `enqueueInvoiceSync` writes one `AccountingSyncLog`
   (PENDING) per connected provider. Idempotent by the DB unique
   `(shop, provider, entity, localId)` — a retry/double-checkout can't enqueue
   twice.
4. **Sync** — `/internal/cron/accounting` (CRON_SECRET, every ~15 min) runs
   `runSyncForShop`: for each due PENDING log it finds/creates the customer,
   creates the invoice, attaches a payment when settled, and records the remote
   id. Failures bump `attempts` and stay PENDING (retried with capped backoff)
   until `SYNC_MAX_ATTEMPTS`, then park as FAILED with a Retry button.
5. **Digest** — the same cron sends at most one `accounting_sync_failure` email
   per batch of new failures (never per-event spam).

## Guardrails

- **Never double-post.** Enqueue + sync are idempotent by the unique tuple; an
  already-synced log is left untouched.
- **A failed sync never blocks the order.** Enqueue is best-effort and swallow-
  and-report; the cron engine never throws upward.
- **Money is never recomputed.** `normalizeInvoice` reshapes the snapshot Shopify
  produced (guardrail #1); it only maps tax codes / accounts.
- **Token security.** OAuth access + refresh tokens are AES-256-GCM encrypted at
  rest (`app/lib/crypto.server.ts`, key = `MANNON_ENCRYPTION_KEY`) and decrypted
  only in transit to the provider. Tokens are **never** written to logs, events,
  or the sync-log `error` field.

## OAuth scopes (external — not Shopify)

Accounting sync adds **no new Shopify OAuth scope**. It authenticates directly
with each provider:

| Provider | Scopes requested |
|---|---|
| QuickBooks Online | `com.intuit.quickbooks.accounting` |
| Xero | `accounting.transactions accounting.contacts offline_access` |

Provider app credentials come from env (`QBO_CLIENT_ID`/`QBO_CLIENT_SECRET`,
`XERO_CLIENT_ID`/`XERO_CLIENT_SECRET`) — the merchant never pastes a secret. Set
each provider's redirect URI to
`https://<app-url>/accounting/callback/<qbo|xero>`.

## Data model (migration `f10_accounting_sync`)

- `AccountingConnection { provider, accessToken*, refreshToken*, realmId?,
  tenantId?, expiresAt?, status, sandbox }` — `*` encrypted. Unique per
  (shop, provider).
- `AccountingSyncLog { provider, entity, localId, remoteId?, status, attempts,
  error?, digested, syncedAt? }` — unique (shop, provider, entity, localId).
- `AccountingMap { taxCodeMap, accountMap, customerMatchStrategy }`.
- Events `ACCOUNTING_CONNECTED`, `INVOICE_SYNCED`.

## Settings, not magic numbers

- `SYNC_MAX_ATTEMPTS` (retry ceiling) and the backoff base/cap live in
  `app/lib/accounting.ts`, documented — not buried in a handler.
- `customerMatchStrategy` (email / name), the tax-code map, and the income
  account are merchant-editable in the mapping UI.

## Reconciliation / notes

- The provider clients (`makeProviderClient`) are intentionally small — three
  calls (find/create customer, create invoice, attach payment). Confirm sandbox
  base URLs + exact payload shapes against each provider's current API before
  go-live; the sync engine is exercised in tests through an injected fake client.
- Silent token refresh on expiry and the embedded deep-link back from the public
  callback (host param) are follow-ups; an expired connection surfaces a
  "Reconnect" banner in the meantime.
- `MANNON_ENCRYPTION_KEY` is **required** to store a connection; without it the
  connect flow errors clearly rather than storing plaintext.
