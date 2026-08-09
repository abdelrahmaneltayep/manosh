# Deploy & Verify — P0-1 / P0-2 (App Store re-submission gate)

The two App Store rejection blockers (ref 126730) are **fixed in code and
committed**. They remain `NEEDS-LIVE` in the QA report until a dev-store run
proves them. This is the runbook to deploy and verify.

| Blocker | App Store rule | Fix commit | Status |
|---|---|---|---|
| P0-1 — billing return URL | 1.2.3 | `fc64698` | fixed in code · verify live |
| P0-2 — nav 404 on tab toggle | 2.1.1 | `fc64698` | fixed in code · verify live |

---

## Code-level verification (already done — deploy is a sure thing)

- **P0-1** — `app/routes/app.settings.tsx` (`billing-subscribe`): the billing
  `returnUrl` now carries `shop` + `embedded=1` + `host` (when present). That is
  exactly the embedded context that was missing when the reviewer saw "enter a
  domain, subscription not applied."
- **P0-2** — `app/routes/app.tsx` + `app/lib/nav.ts`: the nav renders from
  `navFlags(process.env)`. The four always-shown links (Home, Quotes, Buyers,
  Settings) are flag-free and never 404. Every conditional link maps to the exact
  `MANNON_FF_*` flag its route guards on, so the nav can never link to a route
  that would 404.
- `tsc --noEmit` clean · full test suite green · production build succeeds.
- The `claudeEnabled` migration applies automatically on deploy — `fly.toml`
  runs `npx prisma migrate deploy` as the `release_command` before the new
  version goes live.

---

## 1. Deploy

From the repo root, on branch `claude/mannon-feature-slices-w3epbf`:

```bash
git pull origin claude/mannon-feature-slices-w3epbf   # get the latest commit
fly deploy
```

Watch for:
- `release_command` succeeding — that is `npx prisma migrate deploy` applying
  the pending migrations (incl. `claudeEnabled`).
- The health check passing as the new version rolls out.

Then confirm the app is up:

```
open https://manosh.fly.dev/healthz     # expect: ok
```

> If `fly deploy` fails on `release_command` (Fly platform transient — "machine
> not found" / 408): `fly agent restart` then retry `fly deploy`. As a last
> resort, comment out `release_command` in `fly.toml`, deploy, then run the
> migration manually: `fly ssh console -C "npx prisma migrate deploy"`, and
> restore `fly.toml` afterward.

---

## 2. Verify P0-2 — no "Something went wrong" tabs

In the dev store, open the embedded app and **click every nav tab, top to
bottom.**

- **Pass:** every tab loads a page.
- **Fail:** any tab shows the App Bridge "Something went wrong" page.

(Which tabs appear depends on the `MANNON_FF_*` flags set on the Fly app — that
is expected. The test is that *every tab that is shown* loads.)

---

## 3. Verify P0-1 — plan approval re-embeds with the subscription active

1. In the embedded app: **Settings → choose a plan → approve** on Shopify's
   subscription screen.
2. Observe where you land.

- **Pass:** you return to **embedded Settings, with the plan active** (the
  billing section reflects the new plan).
- **Fail:** you land on the OAuth "enter your store" / "enter a domain" page, or
  the subscription is not applied.

---

## Pre-deploy check — billing ladder matches the listing

The plan ladder the reviewer will test depends on `MANNON_FF_PLAN_V3`. Confirm
its value on the Fly app so the plan a merchant approves matches the advertised
prices ($0 / $9 / $29 / $69):

```bash
fly secrets list      # confirm MANNON_FF_PLAN_V3
```

---

## On failure

Capture the exact screen/URL where it broke and paste it back — the fix is in
`app/routes/app.settings.tsx` (P0-1) or `app/routes/app.tsx` + `app/lib/nav.ts`
(P0-2). Do not re-submit to the App Store until both checks pass.
