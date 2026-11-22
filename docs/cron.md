# Scheduled jobs (`/internal/cron/*`)

Mannon has no in-process scheduler. Every recurring job is a resource route under
`/internal/cron/*` that an **external scheduler** must call. Nothing in this repo
(`fly.toml`, `Dockerfile`, CI) schedules them: if no scheduler is configured, none
of these jobs ever run.

## Contract

```bash
curl -fsS -X POST https://manosh.fly.dev/internal/cron/<job> \
  -H "x-cron-secret: $CRON_SECRET"
```

- `POST` preferred; `GET` is accepted for schedulers that cannot POST. Both need the header.
- Auth is the shared `CRON_SECRET` (a Fly secret), sent as `x-cron-secret`. These are not
  Shopify webhooks, so there is no HMAC.
- Responses: `200` JSON `{ ok: true, ... }` on a run; `200` `{ skipped: "feature-off" }` when
  the job's feature flag is off; `401` on a missing or wrong secret; `503` when `CRON_SECRET`
  is not set on the app. Alert on anything that is not `200`.
- Every job is idempotent and loops over all shops itself: one call per job, not per shop.

## Jobs

| Job | Cadence | Flag | What it does |
|---|---|---|---|
| `expire-quotes` | hourly | none (always on) | Flips open quotes past `expiresAt` to `EXPIRED` (`expireQuotesDue`), one `QUOTE_EXPIRED` event each |
| `followups` | every 2–4 h | `MANNON_FF_FOLLOWUPS` | Quote reminders and expiry warnings (business hours only), see `followups.md` |
| `reminders` | daily | `MANNON_FF_CREDIT` | Overdue invoice flips + net-terms reminders, see `net-terms-credit.md` |
| `payment-reminders` | daily | `MANNON_FF_FLEX_PAY` | Installment due/overdue reminders, see `flexible-payments.md` |
| `tax-reminders` | daily | `MANNON_FF_TAX_VAT` | Exemption-certificate expiry reminders, see `tax-vat.md` |
| `analytics` | daily | `MANNON_FF_QUOTE_ANALYTICS` | Daily rollup; weekly digest on Mondays, see `quote-analytics.md` |
| `accounting` | every 15 min | `MANNON_FF_ACCOUNTING_SYNC` | Accounting sync queue, see `accounting-sync.md` |
| `erp` | every 15 min | `MANNON_FF_ERP_SYNC` | ERP order-export queue, see `erp-sync.md` |
| `reorder-push` | weekly | `MANNON_FF_BUYER_PWA` | Reorder push + install nudges, see `buyer-pwa.md` |

Cadences are recommendations, not constants in code: the routes act on whatever is due when
they are called.

### `expire-quotes`

The inbox and Home only *display* an overdue quote as expired (a read never writes). The
stored status changes when a quote's detail is opened, or when this job runs. Without it,
overdue quotes stay `SUBMITTED` / `COUNTERED` in the database, the dashboard and analytics.

- Covers `SUBMITTED`, `COUNTERED` and `ACCEPTED` quotes, per the status machine in `prd.md`.
- It is not behind a feature flag and does not depend on the follow-ups policy. The
  `followups` job also expires quotes, but only for shops with follow-ups enabled and only
  quotes that have a schedule; `expire-quotes` is the authoritative sweep.
- It sends no email. Leftover scheduled reminders for an expired quote are cancelled by the
  next `followups` run.
- **First run:** it expires the whole backlog at once. The `QUOTE_EXPIRED` events carry the
  time of the run, not the original expiry date (events are append-only and never backdated).

## Setting up the scheduler (owner action, outside the repo)

1. Make sure the secret exists on the app: `fly secrets list` shows `CRON_SECRET`. If not,
   set one (`fly secrets set CRON_SECRET=<long random value>`); this restarts the app.
2. Give the same value to the scheduler as a secret, never in a committed file.
3. Create one schedule per job from the table, calling the URL above.

Any scheduler that can send an HTTPS request with a custom header works. Two that need no new
vendor:

- **GitHub Actions.** A workflow on the default branch with `on: schedule` and a step that
  runs the `curl` above, reading `CRON_SECRET` from the repository's Actions secrets. Timing
  is best-effort (runs can start several minutes late), which is fine for every job here.
- **Fly scheduled Machine.** A small Machine in the same Fly org started on a schedule that
  runs the `curl` and exits. Fly offers `hourly` / `daily` / `weekly` / `monthly` only, so the
  15-minute jobs need another scheduler.

Verify after setup: call `expire-quotes` once by hand and check the JSON (`expired` is the
number of quotes flipped), then confirm the next scheduled run in the scheduler's own log.
