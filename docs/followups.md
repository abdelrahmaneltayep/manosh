# Feature 8 — Automated Quote Follow-ups, Expiry & Reminders

Stop quotes going cold: set an expiry, auto-nudge stale quotes on a cadence, and
remind buyers before expiry. Directly lifts quote-to-order conversion.

## Plan availability

| Capability | Starter | Growth |
|---|---|---|
| Quote expiry date | ✓ | ✓ |
| Reminders | **1** (manual/single) | full auto-cadence |
| Multi-nudge + auto-expiry actions | — | ✓ |

`PLAN_LIMITS.followupCadenceMax` (`app/lib/billing.ts`) = 1 (Starter) / 6 (Growth) —
the cadence is clamped in `computeSchedule`. Dark-launched behind
`MANNON_FF_FOLLOWUPS`.

## Core logic (pure, tested)

`app/lib/followups.ts`:
- `clampCadence(cadenceDays, planMax)` — Starter → a single reminder.
- `computeSchedule(submittedAt, expiresAt, policy, planMax)` — reminders on the
  cadence (capped by maxNudges + plan, only before expiry), an expiry warning the
  day before, and the expiry itself.
- `dueFollowups(followups, ctx)` — SCHEDULED + past-due; skips reminders when the
  buyer is unsubscribed or it's outside business hours, but always runs EXPIRED.
- `isBusinessHours(now, tz)` — Mon–Fri 9–18 in the store timezone (`Intl`).

## Model (migration `f8_quote_followups`)

- `FollowupPolicy` (per shop: enabled / expiryDays / cadenceDays / maxNudges).
- `QuoteFollowup` (kind REMINDER/EXPIRY_WARNING/EXPIRED, scheduledFor, status).
- `Quote.reminderState` (per-quote `{ unsubscribed }`), `Shop.timezone`.
- Events `FOLLOWUP_SENT` + the existing `QUOTE_EXPIRED`.

## Scheduler

`/internal/cron/followups` (POST/GET, `x-cron-secret: $CRON_SECRET`, not a webhook).
Per shop it **reconciles** (schedules active quotes with no follow-ups, cancels
terminal ones — so scheduling self-heals even if a call site is missed) then
**dispatches** due reminders/warnings and runs expiries via `expireQuote`.
Schedule it a few times a day so quiet-hours sends land in business hours.

Eager hooks: `scheduleForQuote` on submit (`portal-quote.server`), `cancelForQuote`
on accept (`quote-accept.server`).

## Buyer unsubscribe

Every reminder includes a signed link `/portal/unsubscribe/:id?t=<hmac>` (no login).
It sets `reminderState.unsubscribed` and cancels the quote's scheduled nudges.

## Notes

Emails ride the F2 mailer (no-op until a transport is configured). The reminder /
expiry-warning / expired templates are editable in Settings. Ties into F7's
"stale quotes needing action" list.
