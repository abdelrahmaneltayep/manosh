# Mannon — Go-Live Checklist

Everything is merged to the default branch. This is the runbook to take it live.
The app is **flag-gated and default-off**: deploying changes nothing user-visible
until you flip a `MANNON_FF_*` flag. Roll features out one at a time.

Legend: **Plan** = who the feature is for · **Flag** = env toggle (`=true` to enable)
· **Cron** = a schedule that must be wired · **Deploy** = needs `shopify app deploy`.

---

## 0. One-time platform bring-up (do once, before any feature)

- [ ] **Provision Postgres** and set `DATABASE_URL`.
- [ ] **Run migrations:** `prisma migrate deploy` (24 migrations, `init` → `f20_white_label`).
- [ ] **Core secrets on Fly** (`fly secrets set …`):
  - [ ] `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (client_id `ad4c04f1bcb8aab2dc441ea8bf947a00`)
  - [ ] `SHOPIFY_APP_URL` = the public Fly URL (e.g. `https://manosh.fly.dev`)
  - [ ] `SESSION_SECRET` (strong random), `SCOPES` (see below)
  - [ ] `MANNON_MAIL_FROM` (sender), `SENTRY_DSN`, `POSTHOG_API_KEY` + `POSTHOG_HOST` (optional)
  - [ ] `CRON_SECRET` (shared secret for every `/internal/cron/*` route)
- [ ] **Shopify app config** (`shopify.app.toml`): set `application_url` (currently the `https://example.com` placeholder) to `SHOPIFY_APP_URL`; confirm scopes:
  `read_products, read_orders, write_draft_orders, read_companies, read_payment_terms, read_inventory, write_customers`.
- [ ] **Deploy:** `fly deploy -a manosh`, then `shopify app deploy` (pushes scopes, webhooks, and the F17 theme extension).
- [ ] **Install on the dev store**; confirm GDPR/webhooks register (`app/uninstalled`, `customers/*`, `shop/redact`).
- [ ] **Base smoke test (no flags):** magic-link sign-in → buyer builds a quote → merchant counters → accept → Shopify **draft order** created. `/healthz` returns ok.
- [ ] **Wire the cron scheduler** (Fly Machines schedule / external cron) to POST each route below with header `x-cron-secret: $CRON_SECRET`. A route no-ops when its flag is off, so it's safe to schedule them all up front.

---

## 1. Per-feature rollout

Enable in roughly this order (core value path first). Flip the flag → redeploy/set-secret → run the smoke test → move on.

### Core path

| # | Feature | Plan | Flag | Extra secrets | Cron | Smoke test |
|---|---------|------|------|---------------|------|-----------|
| F1 | AI Quote Assistant | Growth | `MANNON_FF_AI_QUOTE` | `ANTHROPIC_API_KEY` | — | Open a quote → AI suggests a counter + margin read; nothing writes without confirm |
| F2 | Net Terms + Credit | Net terms: both · Credit: Growth | `MANNON_FF_CREDIT` | — | `reminders` | Issue an invoice with due date; aging dashboard + reminder fires |
| F3 | Price Lists | Both (3 on Starter) | `MANNON_FF_PRICELISTS` | — | — | Assign a company price list → buyer sees "you save X%" |
| F4 | Quick Order Pad | Both | `MANNON_FF_ORDERPAD` | `ANTHROPIC_API_KEY` (AI paste) | — | Paste SKUs / a PO → matched cart → submit quote |
| F5 | Company Accounts | Growth | `MANNON_FF_COMPANY_ACCOUNTS` | — | — | Invite a 2nd member; over-threshold order routes to an approver |
| F6 | Wholesale Registration | Both (1 form Starter) | `MANNON_FF_WHOLESALE_REG` | — | — | Public apply form → approve → Company + magic link provisioned |
| F7 | Quote Analytics | Growth | `MANNON_FF_QUOTE_ANALYTICS` | — | `analytics` (daily rollup) | Dashboard shows win rate / discount / time-to-close |
| F8 | Follow-ups & Expiry | Both (cadence Growth) | `MANNON_FF_FOLLOWUPS` | — | `followups` | Quote nears expiry → reminder emails send on schedule |

### Differentiators

| # | Feature | Plan | Flag | Extra secrets | Cron | Smoke test |
|---|---------|------|------|---------------|------|-----------|
| F9 | MOQ / Order Rules | Both (groups+CSV Growth) | `MANNON_FF_MOQ` | — | — | Set case-of-12 → qty 20 rounds to 24; min-order bar fills |
| F10 | Accounting Sync | Growth | `MANNON_FF_ACCOUNTING_SYNC` | `MANNON_ENCRYPTION_KEY`, `QBO_CLIENT_ID/SECRET`, `XERO_CLIENT_ID/SECRET`, `MANNON_MERCHANT_ALERT_EMAIL` | `accounting` | Connect QBO/Xero → invoice syncs; failures log + digest |
| F11 | Custom Catalogs | Both (1 Starter) | `MANNON_FF_CUSTOM_CATALOGS` | — | — | Assign a catalog → buyer sees only their products; hidden SKUs never leak |
| F12 | Sales-Rep Portal | Growth | `MANNON_FF_REP_PORTAL` | — | — | Invite a rep → they order on behalf of an assigned account |
| F13 | Flexible Payments | Growth | `MANNON_FF_FLEX_PAY` | — | `payment-reminders` | Deposit % + installments + pay-link; capture via Shopify checkout |
| F14 | Tax / VAT | Both (workflow Growth) | `MANNON_FF_TAX_VAT` | — | `tax-reminders` | Set default rate + exemption cert; correct tax line on quote |
| F15 | ERP / Inventory Sync | Growth | `MANNON_FF_ERP_SYNC` | `MANNON_ENCRYPTION_KEY` | `erp` (+ POST `/internal/erp/stock`) | Stock in / orders out; two-way sync log; oversell guard |
| F16 | Multi-Currency & Language | Both (extra ccy/locales Growth) | `MANNON_FF_I18N` | — | — | Portal flips to Arabic RTL + SAR; FX rate locks per quote |
| F17 | Storefront Quote Widget | Both (cart/gated/fields Growth) | `MANNON_FF_QUOTE_WIDGET` | `MANNON_MERCHANT_ALERT_EMAIL` | — | **`shopify app deploy`** → add the theme app block → flip per-shop toggle → submit a request → convert to a quote |
| F18 | Buyer PWA & One-Tap Reorder | Both (push Growth) | `MANNON_FF_BUYER_PWA` | `MANNON_VAPID_PUBLIC_KEY` + `MANNON_VAPID_PRIVATE_KEY` (push only) | `reorder-push` | Portal offers "Add to Home Screen"; saved shortcut reorders in one tap |
| F19 | Catalog Sharing & Discovery | Growth | `MANNON_FF_CATALOG_SHARE` | `MANNON_MERCHANT_ALERT_EMAIL` | — | Publish a catalog (prices hidden) → request access → approve → prices unlock |
| F20 | White-Label / Agency | Growth | `MANNON_FF_WHITE_LABEL` | — | — | Link 2 Growth stores → combined rollup → switch without re-login → brand one store's portal only |

---

## 2. Cron schedule (all guarded by `x-cron-secret: $CRON_SECRET`)

| Route | Gated by | Suggested cadence |
|-------|----------|-------------------|
| `POST /internal/cron/reminders` | F2 | daily |
| `POST /internal/cron/analytics` | F7 | daily (rollup) |
| `POST /internal/cron/followups` | F8 | a few times/day (quiet-hours-safe) |
| `POST /internal/cron/accounting` | F10 | hourly |
| `POST /internal/cron/payment-reminders` | F13 | daily |
| `POST /internal/cron/tax-reminders` | F14 | daily |
| `POST /internal/cron/erp` | F15 | per your ERP cadence |
| `POST /internal/cron/reorder-push` | F18 | weekly |

---

## 3. Notes / gotchas

- **VAPID (F18):** install + one-tap reorder work with **no** VAPID keys; web-push
  delivery is a no-op until both keys are set. Generate with `npx web-push generate-vapid-keys`.
- **Encryption (F10/F15):** `MANNON_ENCRYPTION_KEY` (32-byte hex/base64) is **required**
  before connecting any accounting/ERP provider — those integrations are inert without it.
- **F17 needs a Shopify deploy**, not just a flag — the theme app block ships via
  `shopify app deploy`, and each merchant also flips a per-shop enable toggle.
- **F20 billing:** each managed store needs its **own** Growth subscription; linking
  checks `Shop.plan` — the org view never bypasses Shopify billing.
- **Plan gating is enforced server-side** (`requirePlan` / `agencyAllowed` / etc.),
  so a Growth-only feature stays locked on Starter even if its flag is on.
- **Rollback:** to pull a feature, set its flag back to unset/`false` and redeploy —
  data stays; the UI + routes disappear. (F17 also unlists its theme block.)
