# QA-REPORT.md — Mannon pre-submission QA pass

**Date:** 2026-08-09 · **Reviewer:** QA Engineer (static + test-suite pass) · **Branch:** `claude/mannon-feature-slices-w3epbf` @ `fc64698`

> **Scope note (read first).** This pass is **static code analysis + the automated test suite + config/security grep**. It does **not** include live embedded-runtime verification (OAuth handshake in a real admin iframe, App Bridge load, real Web Vitals/LCP/CLS, screen-reader walkthrough, real Claude 429/timeout end-to-end, real webhook delivery). Those items are marked **NEEDS-LIVE** and require a Shopify **development store** + a deployed build. I was not given dev-store credentials, so I did not (and must not) mutate real data.

---

## 1. Verdict

**DO NOT SHIP (yet).** — Blockers open: **2 P0 (deploy-gated)**. P1-1 and P1-2 are now **fixed in code**; P1-3 and P1-4 remain **product decisions** (not review blockers).

The two Shopify-review rejections (ref 126730) are **fixed in code but not yet deployed or live-verified** (P0 until proven on a dev store). Security (secrets, HMAC, GDPR) is **clean**.

> **Update (fixes applied, pending deploy):**
> - **P1-1 RESOLVED** — all 6 unguarded `draft()` actions now `try/catch` and return `CLAUDE_UNAVAILABLE_COPY` (a plain banner) instead of a 500. `app/config/plans.ts` + the 6 routes.
> - **P1-2 RESOLVED (finding corrected)** — on re-inspection, the Free cap **was** enforced on every Free-reachable create path (portal `submitBuyerQuote`, reorder `createReorder`, and request→quote `convertToQuote` via `submitBuyerQuote`). The real defect was the cap **number**: `canCreateQuote` used the legacy limits (Free/Starter → 50) instead of the v3 ladder. Fixed to read `getPlanCapabilities().quotesCap` → **Free = 10, every paid tier = unlimited** (`app/services/plan-limits.server.ts`), with a regression test.
> - Build + typecheck clean; suite **550 passed**.

---

## 2. Blocker list (P0 / P1) — fix these before submitting

### P0-1 — Review fix #1 (billing return URL) is not yet deployed/verified · NEEDS-LIVE
- **Status:** fixed in code (`app/routes/app.settings.tsx` `billing-subscribe`, returnUrl now carries `shop`+`host`+`embedded=1`), commit `fc64698`. **Not deployed; not verified on a store.**
- **Why P0:** this is App Store rejection **1.2.3**. Until a dev-store run proves plan approval lands back in the embedded app with the subscription active, it remains a blocker.
- **Repro (to run live):** Settings → choose plan → approve on Shopify → must return to embedded Settings with the plan active (not the "enter your store" page).
- **Fix location:** already applied at `app/routes/app.settings.tsx` (billing-subscribe branch). Action: **deploy + verify**.

### P0-2 — Review fix #2 (nav 404 on tab toggle) is not yet deployed/verified · NEEDS-LIVE
- **Status:** fixed in code (`app/routes/app.tsx` renders nav from `navFlags(process.env)`; `app/lib/nav.ts`), commit `fc64698`. **Not deployed; not verified.**
- **Why P0:** App Store rejection **2.1.1**. Must prove no tab throws "Something went wrong."
- **Fix location:** applied. Action: **deploy + click every nav tab on the dev store**.

### P1-1 — ~6 Claude actions 500 on API error / missing key (reproduces the reviewer's error) · CONFIRMED (static)
- **Evidence:** `draft()` throws `ClaudeConfigError` when `ANTHROPIC_API_KEY` is unset (`app/services/claude.server.ts:76`) and propagates any Anthropic 429/500/timeout. These action handlers call `draft()` (directly or via a `*-ai.server` helper) with **no `try/catch`**, so the throw becomes a 500 → the App Bridge "Something went wrong" page:
  - `app/routes/app.offers.$id.tsx` — `intent === "ai-offer-draft"` (~L81) → `draftOfferCounter()` uncaught
  - `app/routes/app.quote-requests._index.tsx` — `ai-reply-draft` (~L73) → `draftRequestReply()` uncaught
  - `app/routes/app.followups.tsx` — `ai-followup-draft` (~L73) → `draftFollowupMessage()` uncaught
  - `app/routes/app.settings.tsx` — `ai-template` (~L225–253) → `draft()` uncaught
  - `app/routes/app.quote-forms.$id.tsx` — `ai-thankyou` (~L61) → `draft()` uncaught
  - `app/routes/app.offers.widget.tsx` — `ai-widget-label` (~L61) → `draft()` uncaught
- **Contrast (already correct):** `app.i18n._index.tsx`, `app.tax._index.tsx`, `app.wholesale._index.tsx`, `app.reps._index.tsx`, `app.catalog-sharing._index.tsx` **do** wrap `draft()` and return `{ ok:false, error }`.
- **Repro:** unset `ANTHROPIC_API_KEY` (or force a 500) → click "✦ Draft counter with Claude" on an offer → embedded error page, not a banner.
- **Suggested fix:** wrap each `draft()` call in `try/catch` and return `{ ok:false, error:"Claude is unavailable right now — please try again." , upgrade:false }`, mirroring the i18n/tax handlers. **This is the highest-risk finding for re-review** — it is the same failure mode Shopify flagged.

### P1-2 — Free quote cap: enforcement on the create path is unproven; new limiter is dead code · CONFIRMED (static)
- **Evidence:** `enforceQuoteLimit()` (`app/services/claude-access.server.ts`) has **zero call sites** — dead code. The legacy `canCreateQuote()` is referenced **only in loaders for display** (`app/routes/app.quotes._index.tsx:31`, `app/routes/app.settings.tsx:105`). No enforcement was found on the actual quote-**write** path (portal submit / `convertToQuote` / merchant create).
- **Why P1:** test B requires the Free cap to block the **(limit+1)** quote. If it only *displays* remaining, a Free store can exceed the cap → billing-integrity issue.
- **Repro (live):** on a Free store, create quotes up to the cap, then create one more → must be blocked with a clear message.
- **Fix location:** enforce `canCreateQuote()` (or wire `enforceQuoteLimit`) in the quote-creation action(s): `app/services/quote.server.ts` create path + `app/services/quote-widget.server.ts` `convertToQuote`.

### P1-3 — "Claude on/off toggle" (spec C & D) does not exist · CONFIRMED (static)
- **Evidence:** no merchant preference for enabling/disabling Claude exists. Grep for `claudeEnabled / claude_enabled / claudeToggle / aiEnabled` finds only the **env feature flag** `AI_QUOTE_ENABLED()` (`MANNON_FF_AI_QUOTE`) in `app/routes/app.quotes.$id.tsx`, not a per-merchant toggle. Gating is **plan-based only** (`claudeAccess`).
- **Impact:** the entire **Section C** and the "toggle off → disabled with hint" half of **Section D** cannot pass — the feature isn't built. Manual + "✦ with Claude" dual-action **does** exist; the *saved on/off preference* does not.
- **Decision needed:** is the toggle a launch requirement? If yes, it's net-new work (a `Shop.claudeEnabled` boolean + settings control + an `&& shop.claudeEnabled` in each screen's `access.allowed` check). If no, update the spec. **Not a Shopify-review blocker.**

### P1-4 — Built Claude feature set ≠ the "15 (10 parity + 5 exclusive)" target · CONFIRMED (static)
- **Evidence — actual Claude features found (12 merchant-facing + 1 seed):** registry keys `offer_counter, portal_translations, followup_message, wholesale_decision, thankyou_message, email_template, quote_request_reply, rep_invite_note, tax_reject_note, catalog_title, widget_label` (11) + the F1 quote counter (`app/services/ai/quote-assistant.server.ts`) + `draft_text` (internal seed, not user-facing). Plus AI-1 Magic Order Pad service (`app/services/ai/order-parser.server.ts`) exists.
- **Missing vs the spec's suggested cases:** **reorder prediction, win-rate insight (as a Claude feature), buyer summary, upsell bundle, credit-risk flag** are **not implemented** as Claude features. So the "15" is not met, and ~5 of the spec's tiny test cases have no feature to run against.
- **Fix:** reconcile the roadmap — either build the missing five, or correct the target count in the spec/listing. **Not a review blocker**, but a scope-truth finding.

---

## 3. Matrix results (feature × plan-state)

Legend: ✅ pass (static) · ⚠️ partial / needs-live · ❌ fail · N/A not applicable

### Plan gating (`app/config/plans.ts` `claudeAccess`, `app/config/plans.test.ts` — 15 cases green)
| Plan / state | Claude allowed? | Trial chip | Verified |
|---|---|---|---|
| Free | ❌ locked (`state:"locked"`, `reason:"plan-locked"`) → `<UpgradeToClaude>` | none | ✅ static + unit |
| Starter, trial day 5 | ✅ allowed | "Claude trial · 5 days left" | ✅ static + unit |
| Starter, trial day 1 | ✅ allowed | "1 day left" (⚠️ **no urgent styling** — uniform `tone="attention"`; P3) | ⚠️ |
| Starter, trial ended (0) | ❌ locked (`reason:"trial-ended"`) → upgrade | none | ✅ static + unit |
| Growth | ✅ included | none | ✅ static + unit |
| Scale | ✅ included | none | ✅ static + unit |
| Legacy Starter (grandfathered) | ✅ included (maps to Growth caps) | none | ✅ unit |

Server-side hard-gate: **12** routes call `requireClaudeAccess` and **13** `!access.allowed` guards return an upgrade error — a locked/Free shop **cannot** invoke Claude even by crafting the request. ✅

### Per-feature (static presence + trust line + error handling)
| # | Feature | Route | Trust line | Manual always present | Claude err handled |
|---|---|---|---|---|---|
| 1 | Quote counter | `app.quotes.$id.tsx` | ✅ | ✅ | ✅ (try/catch on ai-suggest) |
| 2 | Make-an-Offer counter | `app.offers.$id.tsx` | ✅ | ✅ | ❌ **P1-1** |
| 3 | i18n translations | `app.i18n._index.tsx` | ✅ | ✅ | ✅ |
| 4 | Follow-up message | `app.followups.tsx` | ✅ | ✅ | ❌ **P1-1** |
| 5 | Wholesale decision note | `app.wholesale._index.tsx` | ✅ | ✅ | ✅ |
| 6 | Quote-form thank-you | `app.quote-forms.$id.tsx` | ✅ | ✅ | ❌ **P1-1** |
| 7 | Invoice/reminder email | `app.settings.tsx` | ✅ | ✅ | ❌ **P1-1** |
| 8 | Quote-request reply | `app.quote-requests._index.tsx` | ✅ | ✅ | ❌ **P1-1** |
| 9 | Sales-rep invite note | `app.reps._index.tsx` | ✅ | ✅ | ✅ |
| 10 | Tax rejection reason | `app.tax._index.tsx` | ✅ | ✅ | ✅ |
| 11 | Catalog public title | `app.catalog-sharing._index.tsx` | ✅ | ✅ | ✅ |
| 12 | Storefront widget label | `app.offers.widget.tsx` | ✅ | ✅ | ❌ **P1-1** |
| — | Magic Order Pad (RFQ→lines) | `app/services/ai/order-parser.server.ts` | ⚠️ verify at its route | — | ⚠️ NEEDS-LIVE |

Trust line present in **12/12** dual-mode routes + the F1 counter. ✅

### Trust & honesty (Section F)
- ✅ No auto-send: every Claude result exposes **"Use this"** (pre-fill) only; the send/save/accept is a **separate manual button**. No auto-send path found.
- ✅ No pre-checked "send" boxes.
- ✅ Below-floor / above-list guard: `app/services/offers-ai.server.ts` + `app/services/ai/quote-assistant.server.ts` flag breaches and **disable** one-click use.
- ⚠️ "Discard actually discards": F1 **Dismiss** hides the suggestion client-side but the `QuoteAiSuggestion` row remains cached in the DB by design (`app/routes/app.quotes.$id.tsx`). Not a dark pattern, but note it does not delete.

### Claude / API integration (Section G)
- ✅ Missing key → `ClaudeConfigError` with a plain message; **key never echoed** (`app/services/claude.server.ts:76`).
- ❌ 429/500/timeout → **P1-1** on ~6 screens (uncaught → 500). The 5 wrapped screens degrade correctly.
- ✅ Injection safety: model output is **forced-tool + temperature 0**, consumed as **data** that pre-fills a field; ids/keys validated in pure code (floor/list guards, translation allow-list, decision-string validation, `{{token}}` preservation). No output can trigger a send/action on its own.

### Security (Section K)
- ✅ **No secret leakage in source.** `ANTHROPIC_API_KEY` appears only in `app/services/claude.server.ts` (a `.server.ts` module — never client-bundled) and by **name** in `app/lib/config-health.ts`. No `sk-ant` literals; the key is never logged or returned. ⚠️ NEEDS-LIVE: grep the built client bundle + a network trace to be 100% certain.
- ✅ All Claude mutations are behind authenticated admin actions (`authenticate.admin` + `requireClaudeAccess`).
- ⚠️ NEEDS-LIVE: CSP `frame-ancestors` for embedding (App Bridge handles this via the SDK; verify response headers on the deployed app).

### GDPR + lifecycle (Sections H, I)
- ✅ All **three** compliance webhooks registered in `shopify.app.toml` (`customers/data_request`, `customers/redact`, `shop/redact`) + `app/uninstalled` + `app/scopes_update`.
- ✅ Each route **HMAC-verifies first** via `verifyWebhook()` (`app/lib/hmac.server.ts`) and returns **401** on bad signature, **200** on success (`webhooks.test.ts` covers signed + unsigned).
- ✅ Handlers **do the work**: `customers/redact` → `redactCustomer()` (deletes buyer + quotes/lines); `shop/redact` → `redactShop()` (cascade delete); `data_request` → verify + assemble/acknowledge (`app/services/gdpr.server.ts`).
- ⚠️ NEEDS-LIVE: uninstall → token/webhook cleanup + billing subscription cancellation end-to-end (`app/routes/webhooks.app.uninstalled.tsx`).

---

## 4. Shopify App Store pre-submission checklist

| Item | Status | Note |
|---|---|---|
| OAuth & embedded load (no redirect loop) | ⚠️ NEEDS-LIVE | Verify after deploying the P0 fixes |
| Session-token auth on reload (no re-consent) | ⚠️ NEEDS-LIVE | `app/routes/app.tsx` authenticates in the shell + each route |
| Billing API + plan enforcement | ⚠️ | Code path correct; **P0-1** (return URL) pending deploy/verify; **P1-2** (Free cap) enforcement unproven |
| GDPR `customers/data_request` | ✅ | HMAC-verified, 200, assembles data |
| GDPR `customers/redact` | ✅ | HMAC-verified, deletes buyer + quotes |
| GDPR `shop/redact` | ✅ | HMAC-verified, cascade delete |
| `app/uninstalled` cleanup | ⚠️ NEEDS-LIVE | Route present; verify cleanup + billing cancel live |
| HMAC verification everywhere | ✅ | `verifyWebhook()` on all webhook routes; 401 on bad sig |
| No secret leakage | ✅ (static) | Server-only; ⚠️ confirm on built client bundle |
| No "Something went wrong" web errors | ❌ | **P0-2** (nav, fixed-pending-deploy) + **P1-1** (Claude-error 500s) |
| Performance thresholds (LCP/CLS) | ⚠️ NEEDS-LIVE | Measure on Home/Quotes/Settings in the embedded iframe |
| Empty / loading / error states | ⚠️ | Present on most screens (empty states + Banners); confirm per-screen live |
| Accessibility (keyboard, SR, AA contrast) | ⚠️ NEEDS-LIVE | Polaris baseline good; contrast rule "lime = fill only" is honored in components |
| Listing assets (name, icon, screenshots, privacy URL) | ❓ | Out of code scope — verify in Partner Dashboard |
| Pricing matches code | ⚠️ | Listing shows Free/Starter/Growth/Scale; **code's active billing path uses legacy Starter/Growth** unless `MANNON_FF_PLAN_V3=true`. Confirm the deployed flag + that listing prices ($0/$9/$29/$69) match `PLAN_PRICING_V3` |

---

## 5. Top fixes, in priority order (for your approval before any code changes)

1. **Deploy the two committed review fixes** (P0-1, P0-2) and **live-verify** on a dev store: plan approval re-embeds + records the subscription; every nav tab loads with no "Something went wrong."
2. **Wrap `draft()` in try/catch on the 6 unguarded actions** (P1-1) → return a plain "Claude is unavailable, try again" banner. Mirror `app.i18n._index.tsx`. *This is the same failure class Shopify rejected — treat as near-P0 for re-review.*
3. **Enforce the Free quote cap on the create path** (P1-2) — wire `canCreateQuote()`/`enforceQuoteLimit()` into the quote-write actions; add a test that the (cap+1) create is blocked.
4. **Decide on the Claude on/off toggle** (P1-3) — build `Shop.claudeEnabled` + settings control (and `&& claudeEnabled` in each `access.allowed`), or amend the spec.
5. **Reconcile the feature count** (P1-4) — build the missing five Claude features (reorder prediction, win-rate insight, buyer summary, upsell bundle, credit-risk flag) or correct the "15" target in the listing/spec.
6. **Polish (P3):** urgent styling for the Starter trial on day ≤1 (currently uniform `tone="attention"`); confirm "Discard" copy given the suggestion is cached, not deleted.
7. **Confirm the `MANNON_FF_PLAN_V3` flag + prices** so the deployed billing ladder ($0/$9/$29/$69) matches the listing and the code path.

---

### Automated suite (evidence)
`vitest run` → **546 passed / 117 skipped** (skips are DB-integration tests that require a live Postgres). `tsc --noEmit` clean; `remix vite:build` clean. Not a substitute for the NEEDS-LIVE items above.
