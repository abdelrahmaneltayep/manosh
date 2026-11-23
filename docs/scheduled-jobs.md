# Scheduled jobs

Mannon has nine background jobs. None of them runs by itself: each is an HTTP route
that does its work when a scheduler calls it with the shared secret. **If nothing
calls a route, that feature is silently idle** — no error, no email, no sync.

Checked on 2026-11-23: production answered `503 CRON_SECRET not set`, so no job was
running. Follow "Turn it on" below.

## The jobs

All routes are `POST https://manosh.fly.dev/internal/cron/<job>` with the header
`x-cron-secret: <CRON_SECRET>` (GET works too, for schedulers that can't POST).

| Job | How often | What it does | If it never runs | Feature flag |
|---|---|---|---|---|
| `quote-expiry` | Hourly | Marks open quotes past their expiry date as Expired, one `QUOTE_EXPIRED` event each | Overdue quotes stay "New" / "Countered" in the database, in Home's counts and in the buyer portal | none (core) |
| `followups` | Hourly | Schedules and sends quote follow-ups and expiry warnings; expires quotes on a follow-up policy | No follow-up or expiry-warning emails | `MANNON_FF_FOLLOWUPS` |
| `accounting` | Hourly (every 15 min is better) | Pushes pending invoices to QuickBooks / Xero with backoff; one failure digest | Accounting sync queue never drains | `MANNON_FF_ACCOUNTING_SYNC` |
| `erp` | Hourly (every 15 min is better) | Exports pending orders to the connected ERP with backoff; one failure digest | ERP exports never leave | `MANNON_FF_ERP_SYNC` |
| `reminders` | Daily | Flags overdue invoices (all plans); emails T-3 / due / +7 reminders (Growth and Scale) | Invoices never show as overdue; no payment reminders | `MANNON_FF_CREDIT` |
| `payment-reminders` | Daily | Flags overdue instalments and emails due / overdue reminders | No deposit or instalment reminders | `MANNON_FF_FLEX_PAY` |
| `tax-reminders` | Daily | Emails buyers whose exemption certificate expires within 30 days | Certificates lapse without notice | `MANNON_FF_TAX_VAT` |
| `analytics` | Daily | Builds yesterday's quote metrics (Growth and Scale); on Mondays sends the opt-in weekly digest | Quote analytics has no new data | `MANNON_FF_QUOTE_ANALYTICS` |
| `reorder-push` | Weekly | Sends opt-in reorder nudges to buyers | No reorder nudges | `MANNON_FF_BUYER_PWA` |

Most jobs are safe to retry or to call more often, because they record what they sent
or changed and a second run finds nothing to do (`quote-expiry`, `reminders`,
`payment-reminders`, `tax-reminders`, the sync queues, the daily metrics). Two are
not guarded, so keep them at the listed frequency: `analytics` sends the weekly digest
on **every** call made on a Monday, and `reorder-push` sends its nudges on every call.

Responses: `200` with a JSON summary when it ran, `200 {"skipped":"feature-off"}` when
its flag is off, `401` for a missing or wrong secret, `503` when the app has no
`CRON_SECRET`.

## Turn it on

Three steps, about five minutes. Run the commands on your own machine.

1. **Create the secret and give it to the app.** This restarts the app once.

   ```
   openssl rand -hex 32
   fly secrets set CRON_SECRET=<paste the value>
   ```

2. **Give the same value to the scheduler.** On GitHub: the repository → Settings →
   Secrets and variables → Actions → New repository secret, named `CRON_SECRET`.

3. **Run it once by hand.** GitHub → Actions → "Scheduled jobs" → Run workflow →
   `hourly`. The log prints one line per job, for example
   `quote-expiry -> HTTP 200 {"ok":true,...,"expired":89}`.

After that `.github/workflows/scheduled-jobs.yml` calls the jobs by itself:

| Group | When (UTC) | Jobs |
|---|---|---|
| Hourly | minute 7 of every hour | `quote-expiry`, `followups`, `accounting`, `erp` |
| Daily | 06:17 | `reminders`, `payment-reminders`, `tax-reminders`, `analytics` |
| Weekly | Monday 07:23 | `reorder-push` |

Until the GitHub secret exists the workflow does nothing: it prints a notice and exits.

To check a single job from a terminal:

```
curl -X POST https://manosh.fly.dev/internal/cron/quote-expiry -H "x-cron-secret: <value>"
```

## Things to know about GitHub's scheduler

- Runs can start several minutes late when GitHub is busy. Nothing here needs to be
  on the minute.
- GitHub can switch off scheduled workflows in a repository with no activity for 60
  days, and it emails you when it does. Re-enable it under Actions.
- A failed job turns the run red and GitHub emails the repository owner.
- Each run uses about a minute of Actions time: roughly 750 minutes a month in total.
- Accounting and ERP sync run hourly here to stay inside the free minutes. To sync
  every 15 minutes, use a scheduler without that limit (below) for those two.

## Using a different scheduler

Anything that can send a POST with a header works: a Fly scheduled machine, a hosted
cron service, or a server crontab. Keep three rules: send the secret as the
`x-cron-secret` header and never in the URL, use HTTPS, and treat any status other
than 200 as a failure worth an alert.

## Adding a job

Follow `app/routes/internal.cron.quote-expiry.tsx`: check `CRON_SECRET` first (503 when
unset, 401 on mismatch), do the work through a service, return a JSON summary, and make
a second run a no-op. Then add the job to the workflow's group, to this table, to the
QA list in `scripts/qa/suites/platform.mjs` (case C13) and a route test.
