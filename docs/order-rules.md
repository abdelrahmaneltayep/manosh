# Feature 9 — MOQ, Order Minimums & Pack/Case-Size Rules

Standard wholesale controls so no unprofitable or invalid order slips through:
minimum order quantity per product, order-value minimums, and pack/case-size
multiples.

## Plan availability

| Capability | Starter | Growth |
|---|---|---|
| Store minimum order value | ✓ | ✓ |
| Product MOQ | ✓ | ✓ |
| Collection / customer-group scopes | — | ✓ |
| Pack / case-size multiples | — | ✓ |
| CSV bulk import | — | ✓ |

`allowedRuleScopes(plan)` + `packRulesAllowed(plan)` (`app/lib/billing.ts`) gate the
editor, CSV, and each create. Dark-launched behind `MANNON_FF_MOQ`.

## The resolver (the core — one place, three surfaces)

`app/lib/order-rules.ts` is pure and unit-tested:
- **Specificity** — product > customer-group > collection > store; the most
  specific matching rule wins (tie → higher priority).
- **`adjustLine`** — rounds a quantity **up** to the pack multiple and enforces the
  MOQ (then re-rounds so the minimum lands on a pack boundary), returning a plain
  explanation. Never returns less than requested; lines are never dropped.
- **`evaluateCart`** — adjusts every line, sums the subtotal, and checks it against
  the applicable order-value minimum → `shortfall` + `ok`.

Enforced identically in:
1. **Portal cart / order pad** (`portal.quotes.new` submit + `portal.quick-order`
   live display with a minimum-order progress bar).
2. **Submit** (`portal-quote.server.submitBuyerQuote`) — rounds quantities, blocks
   under-minimum with the shortfall message.
3. **Quote → order conversion** (`quote-accept.server`) — re-checks a countered
   quote, rounds up (persisted), blocks under-minimum, and logs
   `ORDER_RULE_APPLIED`.

## Data model (migration `f9_moq_rules`)

`OrderRule { scope, targetId, minQty, packSize, minOrderValue, priority }`, event
`ORDER_RULE_APPLIED`. Scope targets with our data: PRODUCT → variantId,
CUSTOMER_GROUP → companyId (reuses F5 company as the "group"), STORE → all.

## Reconciliation / notes

- **COLLECTION** rules are storable/editable but matching needs product→collection
  data we don't cache yet, so they match only when `collectionIds` are supplied — a
  documented follow-up (fetch product collections from the Admin API).
- No emails (in-cart messaging only). CSV columns:
  `scope,target_id,min_qty,pack_size,min_order_value,priority`.
