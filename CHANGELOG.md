# Changelog

All notable changes to Mannon are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Dates are UTC.

## [Unreleased]

### Added — Feature 1: AI Quote Assistant (Growth)

- **AI counter-offers inside a quote.** On an open (SUBMITTED) quote, merchants
  can click **AI suggest** on a line — or **Suggest counter-offer for all lines** —
  to get a suggested unit price, a margin/risk read, and a ready-to-send buyer
  message. Accept prefills the counter field; Edit and Dismiss are one click away.
- **Floor-margin guardrail.** A new per-shop setting, **AI floor margin**
  (default 15%), sets the lowest margin the assistant will knowingly propose. Any
  suggestion that breaches it is flagged in red and can't be accepted in one
  click. The floor is enforced in pure, unit-tested code — never trusted to the
  model.
- **Real margins.** Wholesale cost is read from Shopify
  (`ProductVariant.inventoryItem.unitCost`, new `read_inventory` scope) and cached
  per variant (`VariantCost`).
- **Plan gating.** The assistant is **Growth-only**
  (`requirePlan(billing, GROWTH_PLAN)` on the action, `featureAccess` in the UI).
  Starter merchants see a locked upsell. The public `/pricing` page and in-app
  Plans matrix show the Growth badge.
- **Guardrails.** Temperature 0, forced tool call, no autonomous action — AI
  drafts, a human confirms (guardrail #4). Every suggestion appends an
  append-only `AI_SUGGESTION_USED` event (ids + numbers only, no PII).
- **Dark launch.** Gated behind the `MANNON_FF_AI_QUOTE` feature flag.

### Notes

- Migration: `f1_ai_quote_assistant` (adds `Shop.minMarginPct`, `VariantCost`,
  `QuoteAiSuggestion`, and the `AI_SUGGESTION_USED` event type).
