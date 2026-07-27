# Feature 1 — AI Quote Assistant (Growth)

Mannon's headline differentiator. Inside an open quote, the merchant gets AI help
to counter-offer: a suggested price, a margin/risk read, and a one-click drafted
buyer message. **AI drafts; a human always confirms** (guardrail #4).

## Availability & gating

- **Growth plan only.** Enforced server-side with `requirePlan(billing, GROWTH_PLAN)`
  / `featureAccess(status, GROWTH_PLAN)` on the quote action, and mirrored in the
  UI (locked button + upsell on Starter). See `app/lib/billing.ts`.
- **Feature flag:** `MANNON_FF_AI_QUOTE`. The UI and action are inert unless it is
  set to `true` — lets us dark-launch. Set it in the Fly app env
  (`fly secrets set MANNON_FF_AI_QUOTE=true --app manosh`).

## How a suggestion is made

1. Merchant clicks **AI suggest** on a line (or **Suggest counter-offer for all
   lines**).
2. `generateSuggestionForLine` (`app/services/quote-ai.server.ts`) assembles the
   context: requested qty, current/list price, cached **unit cost**, short prior
   quote history with the company, and the shop's **floor margin**.
3. `suggestCounterOffer` (`app/services/ai/quote-assistant.server.ts`) calls Claude
   Haiku (`claude-haiku-4-5`) at **temperature 0** with a **forced tool call**,
   then runs the model output through the pure floor math.
4. The result is persisted (`QuoteAiSuggestion`) and cached as the latest
   suggestion for that line. An append-only `AI_SUGGESTION_USED` event is written
   (ids + numbers only, no PII).

## The floor-margin guardrail

- Per-shop setting **`Shop.minMarginPct`** (default 0.15), editable in Settings as
  *AI floor margin (%)*.
- Floor price = `cost / (1 − minMarginPct)`, computed in pure code
  (`computeFloorPrice`). The model is *told* the floor, but we **never trust it** —
  `finalizeSuggestion` flags `belowFloor` whenever the model's price dips under it.
- A breaching suggestion shows a red warning and **disables one-click accept**; the
  merchant must edit the price to proceed.
- When Shopify has no cost on file, margin is shown as unknown and no floor is
  enforced (the model is told to stay at or above list price).

## Cost data

- Read from `ProductVariant.inventoryItem.unitCost` (needs the **`read_inventory`**
  scope; documented in `docs/compliance.md`).
- Cached per variant in `VariantCost` (cache-through, 24h TTL). Reference-only —
  the authoritative money is still the draft order, never computed by us.

## Data model

- `QuoteAiSuggestion` — one row per suggestion (line-level or quote-level).
- `VariantCost` — cached wholesale cost per variant.
- `Shop.minMarginPct` — the floor-margin setting.
- `EventType.AI_SUGGESTION_USED` — funnel event.

Migration: `f1_ai_quote_assistant`.

## Rate limiting

In-memory per-shop throttle (`AI_RATE_LIMIT_MS`, 1.5s) so rapid clicks can't fan
out model calls. The last suggestion is cached in the DB and reused by the page
loader.

## Guardrails checklist

- [x] Temperature 0, forced tool, no autonomous write (guardrail #4).
- [x] Floor enforced in pure, unit-tested code — not trusted to the model.
- [x] Append-only event, no PII in payload (guardrail #6).
- [x] Minimum scope added with a documented reason (guardrail #2).
- [x] Empty state (no suggestions yet) and error/loading states designed.
