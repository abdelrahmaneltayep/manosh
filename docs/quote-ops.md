# F25 — Quote Ops & Conversion

The merchant-side "get it to a closed deal" surface. Reuses Shopify draft orders,
F13 (payments), F20 (white-label for the branded PDF). Built one slice at a time
(PR-9a → PR-9e).

## PR-9a — One-click convert: quote → draft order → invoice (§6.2)

From an **accepted** quote (or a **countered** one the buyer has agreed to offline),
the merchant creates a native Shopify **draft order** at the buyer's exact
negotiated prices and emails them the invoice — in one click.

### No second pricing brain, no silent re-price

`convertQuoteToOrder` (`app/services/quote-convert.server.ts`) reuses the S8
draft-order builder (`buildDraftOrderInput` → `createDraftOrder`) and takes each
line's price **verbatim** from `Quote.lines[].price` (`price.toString()`). We never
re-price from the live catalog — Shopify then calculates tax + totals on top
(guardrail #1). A test asserts the draft-order `priceOverride` amounts equal the
quote's stored prices exactly.

### Order of operations (mirrors S8)

1. **Shopify first** — `createDraftOrder` (source of truth for money).
2. **Invoice** — `sendDraftOrderInvoice` (`draftOrderInvoiceSend`), **best-effort**:
   the order stands even if the email hiccups (logged to Sentry). Skippable with
   `sendInvoice: false` for the F13 deposit / pay-by-link / F2 net-terms paths.
3. **Then** mutate state — `COUNTERED → ACCEPTED → ORDERED` (or `ACCEPTED → ORDERED`),
   set `Quote.convertedOrderId` (+ `draftOrderId`), append `QUOTE_CONVERTED`.

So a Shopify failure never strands the quote. `convertedOrderId` mirrors
`Offer.convertedOrderId` (F21) — the F25 convert marker.

### Data (`migration quote_ops`)

`Quote.convertedOrderId` (gid) + Event `QUOTE_CONVERTED`.

### Gating (§6.2 — Starter+)

The admin action (`/app/quotes/:id`, intent `convert`) requires a paid plan
(`featureAccess(status, Starter)`); below that it returns an upgrade prompt. The
buyer must be linked to a company location (native purchasing entity), exactly like
the S8 accept→order path — otherwise convert is blocked with a plain-language error.

### Admin

The quote detail shows **Convert to order & send invoice** on an accepted/countered
quote (not yet ordered); once converted it shows an "Order created" banner. Buyer
not linked to a company location → a clear error, nothing stranded.

## Not yet (later slices)

Branded quote PDF (PR-9b), duplicate quote (PR-9c), bulk CSV import (PR-9d), new
customer-account UI extension (PR-9e).
