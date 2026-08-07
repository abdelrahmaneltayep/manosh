# /docs/dual-mode.md — Mannon dual-mode (Manual + Claude)

Every merchant-facing screen that produces text or a priced decision is **dual-mode**: it works
fully in **Manual** mode on every plan, and — where the shop has Claude access — offers a
**✦ Draft with Claude** action that only *pre-fills* the manual controls. Claude never sends,
accepts, charges, or commits anything. A human always clicks the final Send / Save / Accept /
Reject button.

This is guardrail #4 (`CLAUDE.md`) made concrete across the app. Model is **Claude Haiku 4.5**
(`claude-haiku-4-5`), temperature **0**, forced tool-use, prompt-cached system prefix — same as
the rest of Mannon's AI (`/docs/ai-spec.md`).

---

## The contract (holds on every screen)

1. **Manual first.** The normal B2B form/table works on all plans with no AI. Removing Claude never
   removes the feature.
2. **Pre-fill only.** A Claude draft lands in an editable control (a field, or a "Use this" that
   fills one). Nothing is sent or written until the merchant acts.
3. **One trust line, everywhere.** Every Claude output closes with the shared block ending:
   `✦ Drafted by Claude · review before sending. You send it, not the AI.`
   (`DRAFTED_BY_CLAUDE_TRUST` in `app/config/plans.ts`).
4. **Gating is one function.** `claudeAccess(shop, now)` decides included / trial / locked — nothing
   else re-implements it.
5. **Validated output.** Ids, prices, keys returned by the model are checked in pure, unit-tested
   code before use (floor/list guards, translation-key allow-lists, decision-string validation).
   The model is never trusted on money or on ids.
6. **Append-only analytics.** Each draft records one `AiEvent` (feature key + token counts, no PII).

---

## Plan gating — who gets Claude

Decided by `claudeAccess()` in `app/config/plans.ts`, keyed off the v3 capability map
(`app/lib/billing-v3.ts`) so grandfathering and the Shopify trial are already handled:

| Effective plan | Claude state | Behaviour |
|---|---|---|
| Growth · Scale (and grandfathered-up legacy) | `included` | Always on. |
| Starter (incl. Shopify TRIAL) | `trial` | One-time **7-day** Claude trial (`CLAUDE_TRIAL_DAYS`). |
| Free · Starter after the trial | `locked` | Claude controls replaced by `<UpgradeToClaude>`. |

- The trial **starts on first real use**, never on a page view. The loader computes access
  read-only; the *action* calls `requireClaudeAccess(shop, { startTrialOnUse: true })`, which
  persists `Shop.claudeTrialStartedAt = now` exactly once.
- `claudeAccess()` is pure — `now` is always injected — and exhaustively covered in
  `app/config/plans.test.ts`.

Separately, **quotes** are capped on Free and unlimited on every paid tier
(`evaluateQuoteAllowance` / `enforceQuoteLimit`).

---

## The foundation (Task 0)

| Concern | Where |
|---|---|
| Pure gating + trust/upgrade copy + `CLAUDE_TRIAL_DAYS` / `CLAUDE_MODEL` | `app/config/plans.ts` (+ `.test.ts`) |
| Single model entry point `draft({ feature, input, shopId })` | `app/services/claude.server.ts` (+ `.test.ts`) |
| Per-feature prompt registry (core) | `app/services/prompts/registry.ts` |
| Registry aggregator (imports every feature) | `app/services/prompts/index.ts` |
| Server guards `requireClaudeAccess` / `assertClaudeAllowed` / `enforceQuoteLimit` | `app/services/claude-access.server.ts` |
| UI: `<DualMode>` · `<UpgradeToClaude>` · `<DraftedByClaude>` | `app/components/*` |
| `Shop.claudeTrialStartedAt` + append-only `AiEvent` model | `prisma/schema.prisma` (migration `20260807120000_dualmode_claude_foundation`) |

`draft()` is generic: it looks the feature up in the registry, invokes Haiku with that feature's
forced tool, records the `AiEvent` (best-effort — a failed insert never blocks the merchant's
draft), and returns the raw validated tool output for the caller to map into its manual form.
`ANTHROPIC_API_KEY` is read from the environment, never logged or returned; a missing key surfaces
as a plain-language error, not a crash.

---

## The prompt registry

Each feature registers **one file** under `app/services/prompts/`, exposing a `FeaturePrompt`
(stable `key`, cached `system` prompt built on `SHARED_RULES`, a forced `tool`, and a typed
`buildUser`). Files import `registerFeature` from `registry.ts`; `index.ts` imports the files for
their registration side-effect (one-directional graph → no circular import). Adding a feature is a
new file + one import line.

Registered feature keys (also the `AiEvent.feature` values):

| Key | Screen |
|---|---|
| `draft_text` | seed / generic helper |
| `offer_counter` | F21 Make an Offer — counter + note |
| `portal_translations` | F16 i18n — portal string translations |
| `followup_message` | F8 follow-ups — reminder body |
| `wholesale_decision` | F6 wholesale — approve/decline/more-info note |
| `thankyou_message` | F24.1 quote-form — post-submit copy |
| `email_template` | F2 — invoice/reminder subject + body |
| `quote_request_reply` | F17 — request acknowledgement |
| `rep_invite_note` | F12 — sales-rep invite welcome |
| `tax_reject_note` | F14 — tax-exemption rejection reason |
| `widget_label` | F21 — storefront button label |

`SHARED_RULES` (in `registry.ts`) is prepended to every feature's system prompt: draft-only,
invent-nothing, never exceed stated limits, always answer through the tool.

---

## Recipe — adding Claude to a screen

1. **Prompt file** `app/services/prompts/<feature>.ts` — `registerFeature({ key, system:
   withSharedRules(...), tool, buildUser })`; add the import + re-export in `index.ts`. Colocate a
   `.test.ts` for `buildUser`.
2. **Orchestration** (only if the draft needs DB context): a small `*-ai.server.ts` that loads the
   owned row, calls `draft(...)`, and applies pure guards on the output (keep those guards
   unit-tested — that's the guardrail boundary).
3. **Route loader** — compute `access = claudeAccess(shopRow, new Date())` **read-only** and return
   it.
4. **Route action** — add an `ai-<feature>` intent: `requireClaudeAccess(shop, { startTrialOnUse:
   true })`, bail to `CLAUDE_UPGRADE_COPY` / `CLAUDE_TRIAL_ENDED_COPY` when `!access.allowed`, else
   `draft(...)` and return the result. If the screen sent a template-only email, thread an optional
   `customBody` / `customNote` param through the existing send so a merchant-reviewed draft can
   replace the default (links/footers stay appended).
5. **UI** — render the ✦ action when `access.allowed`; show a trial badge when `access.state ===
   "trial"`; on `!access.allowed` render `<UpgradeToClaude access={access} />`. Put the draft in a
   result block that ends with the trust line, and a **Use this** that fills the manual control. Do
   NOT auto-apply — the merchant clicks.

Two UI shapes are in use: `<DualMode>` (Manual | ✦ tabs) for screens where Claude and Manual are
alternative ways to fill one form; and an **inline / per-row** shape (a compose row or a button
beside a field) where drafts interleave with the manual controls — F1's per-line suggestions, and
the per-item compose cards on Follow-ups, Wholesale, Quote-requests, and Tax. Both honour the same
contract; pick whichever keeps the primary task obvious and fast.

---

## Definition of done (per dual-mode slice)

- Manual path unchanged and still works with Claude locked.
- Model output validated in pure, tested code; ids/prices never trusted.
- Trust line present; trial badge + `<UpgradeToClaude>` wired via `claudeAccess`.
- `AiEvent` recorded.
- `npm run build`, `tsc --noEmit`, and `vitest run` all green.
