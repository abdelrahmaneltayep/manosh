# Feature 17 — Embedded "Request a Quote" Storefront Widget

A theme-app-extension button that turns any product or cart page into a "Request
a Quote" entry point — the top of funnel for the whole app. Both plans (partial by
capability), dark-launched behind `MANNON_FF_QUOTE_WIDGET` **and** a per-shop
enable toggle.

## Install (theme app extension — no theme code editing)

The extension lives in `extensions/quote-widget/`:

- `shopify.extension.toml` — a `theme` extension, `block_only`.
- `blocks/quote_button.liquid` — the app block (button + modal), with block
  settings (label, accent, advanced app URL).
- `assets/quote-widget.{js,css}` — the storefront widget (async, self-scoped).

Deploy with `shopify app deploy`, then in the store: **Online Store → Customize →
Add block → "Request a Quote"** on a product or cart section. The block reads
`shop.permanent_domain` and the current product/variant from Liquid; the merchant
also flips the per-shop **enable** toggle in Mannon (`/app/quote-requests`).

## Public API

| Route | Method | Purpose |
|---|---|---|
| `/api/quote-widget-config?shop=` | GET | Public config: `{ enabled, label, gated, cartEnabled, customFields }` (no secrets) |
| `/api/quote-request` | POST / OPTIONS | Submission — CORS, validated + escaped, anti-spam |

Both are CORS-enabled (the storefront is a different origin) and public by design.

## Anti-spam + safety (guardrail)

- **Honeypot** (`company_url_confirm`, shared with F6) — a bot fills it, a human
  never sees it.
- **Rate limit** per (shop, IP) — 5 / minute (shared `submitRateOk`).
- **Too-fast submit** timer — a sub-1.2s render→submit is treated as a bot.
- Spam/rate-limited requests return a **generic success** so bots learn nothing.
- **All input is validated + escaped server-side** (`validateQuoteRequest`,
  `escapeText` strips `<>` + control chars, caps lengths, coerces quantities).
- **Never exposes hidden-catalog SKUs**: config carries no catalog data, and on
  convert, lines resolve only against the buyer's **F11 visible** catalog.
- Loads **async** — a config/network failure fails closed (no button), never
  slowing the storefront.

## One-click convert → F1 quote

`convertToQuote` ensures a Company + Buyer for the email (reuses a known buyer +
their price list; else provisions a lightweight "lead" company with a synthetic
`quote-request:<id>` Shopify company id), resolves the request's lines against the
visible catalog (by variantId, then SKU), and calls `submitBuyerQuote` — so the
new quote runs through the whole pipeline (F9 MOQ, F16 FX-lock, etc.) and enters
the F1 AI counter-offer flow. The request is marked `CONVERTED` and linked to the
`Quote`.

## Plan gating (partial by capability)

| Capability | Starter | Growth |
|---|---|---|
| PDP button + basic form | ✓ | ✓ |
| Cart-level requests | — | ✓ |
| Gated-to-wholesale mode | — | ✓ |
| Custom form fields | — | ✓ |
| Auto-prefill for known buyers | — | ✓ |

`quoteWidgetFeatures(plan)` (`app/lib/billing.ts`); Growth-only toggles are forced
off on Starter server-side regardless of the form.

## Data model (migration `f17_quote_widget`)

- `QuoteRequest { source, email, companyName?, lines, note?, customFields?, status, convertedQuoteId? }` (unique `convertedQuoteId` → Quote).
- `Shop.quoteWidgetEnabled / quoteWidgetLabel / quoteWidgetGated / quoteWidgetCartEnabled / quoteWidgetCustomFields`.
- Event `QUOTE_REQUEST_CREATED`; templates `quote_request_created` (merchant), `quote_request_ack` (visitor).

## Reconciliation / notes

- The submission API is CORS-public rather than a signed App Proxy to keep the
  storefront integration simple; abuse is bounded by honeypot + rate limit + too-
  fast + server-side validation. Moving to an App Proxy (Shopify-signed) is a
  documented hardening follow-up.
- Lead companies use a synthetic `quote-request:` Shopify company id, reconciled to
  a real `gid://shopify/Company` on the first order (same pattern as F6).
- No new Shopify OAuth scope. `MANNON_MERCHANT_ALERT_EMAIL` receives new-request
  notices; the visitor gets an acknowledgement.
