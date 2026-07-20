# Submission runbook (S20)

The final slice: everything needed to submit Mannon to the Shopify App Store,
plus the last piece of **metrics wiring** so the AARRR funnel is complete end to
end. Work through this on a dev store before hitting "Submit for review".

---

## Metrics wiring — the funnel is now complete

Every AARRR stage has a real emitter feeding the append-only Event stream, which
`appendEvent` mirrors into PostHog (S14). Nothing is left stubbed:

| Stage | Event | Emitted by |
|---|---|---|
| Acquisition | `APP_INSTALLED` | `afterAuth` → `ensureShopInstalled` (S20) |
| Acquisition | `TRIAL_STARTED` | `reconcileShopPlan` on first subscribe (S17) |
| Activation | `QUOTE_SUBMITTED` / `QUOTE_COUNTERED` | quote machine (S5/S6) |
| Activation | `REORDER_CREATED` | reorder (S9) |
| Activation | `AI_PARSE_ACCEPTED` | Magic Order Pad confirm (S12) |
| Revenue | `QUOTE_ACCEPTED` / `QUOTE_ORDERED` / `DRAFT_ORDER_CREATED` | accept → draft order (S8) |
| Revenue | `PLAN_UPGRADED` / `PLAN_CANCELLED` | billing (S17) |
| Referral | `REVIEW_PROMPT_SHOWN` | dashboard review banner (S20) |

**Install provisioning (S20):** the Shopify `afterAuth` hook now calls
`ensureShopInstalled`, which creates the `Shop` row, starts the 14-day trial
clock, and records `APP_INSTALLED` exactly once. This also closes a real gap —
settings-save, plan reconciliation, and the dashboard all require that row.

**Review prompt (S20):** the dashboard surfaces a review request only after the
merchant has created at least one order, and only once (`shouldPromptReview` /
`markReviewPromptShown`, both derived from the Event stream). The prompt is
acknowledged via a POST so the GET dashboard stays read-only.

---

## Pre-submission checklist

### App setup (Partner Dashboard)
- [ ] `shopify app config link` against the real Partner app; `client_id`,
      `application_url`, and redirect URLs are filled in (currently placeholders).
- [ ] Confirm the API version (`2025-01`) and scopes are still current via the
      Shopify Dev MCP.
- [ ] Deploy so the declarative webhooks in `shopify.app.toml` register.

### Compliance (S15 — hard gate)
- [ ] Three GDPR webhooks (`customers/data_request`, `customers/redact`,
      `shop/redact`) respond, and all webhooks reject bad HMAC with 401.
- [ ] `app/uninstalled` cleans up store data.
- [ ] Scopes are minimal and each is justified in `docs/compliance.md`.

### Billing (S17)
- [ ] Subscribe on a dev store starts a 14-day trial; upgrade, downgrade, and
      cancel all work from **Settings**.
- [ ] Growth features show locked on Starter/trial and unlock on Growth.

### Listing (S18)
- [ ] Paste the copy from `docs/listing.md` into the listing fields.
- [ ] Capture the 6 screenshots from the shot-list on a dev store; produce the
      1200×1200 app icon.
- [ ] Privacy policy URL points to `/privacy` (live), support email is set.

### Quality (S19)
- [ ] `npm run typecheck`, `npm test`, and `npm run build` are green.
- [ ] `docs/self-review.md` gauntlet passes (guardrails + definition of done).

### Live smoke test (needs a dev store — cannot run in CI/container)
- [ ] Install → Shop row created, `APP_INSTALLED` recorded, trial started.
- [ ] Invite a buyer (magic link) → buyer signs in to the portal.
- [ ] Buyer requests a quote → merchant counters → buyer accepts → a real Shopify
      draft order is created with Shopify's totals + terms/PO.
- [ ] Buyer reorders a past order; within tolerance it auto-converts.
- [ ] Paste a PO into the Magic Order Pad → matched lines → confirm → quote.
- [ ] Dashboard shows the revenue made and, after the first order, the review
      prompt (once).

---

## Known deferrals

- **Screenshots + app icon** are a shot-list/spec in `docs/listing.md` — capture
  on a dev store before submission.
- **Review deep link** points at `https://apps.shopify.com/mannon` (the listing
  handle); update it to the final handle once the listing is created. The
  `REVIEW_PROMPT_SHOWN` metric is wired regardless of the link target.
- **Live Shopify/AI/billing calls** are covered in-container by tests against
  mocked clients + real Postgres; exercise them once against a dev store using
  the smoke test above.
