# Feature 4 — Enhanced Quick Order / Bulk Order Pad

The fastest way for a buyer to build a big order: SKU search, paste, saved lists,
CSV, and a live subtotal — keyboard-first.

## Plan limits

| Capability | Starter | Growth |
|---|---|---|
| SKU/product search + paste | ✓ | ✓ |
| Saved lists | up to **3** | unlimited |
| CSV upload | — | ✓ |
| Live subtotal (F3 pricing) | ✓ | ✓ |

`PLAN_LIMITS.savedListCap` (`app/lib/billing.ts`) = 3 (Starter) / ∞ (Growth). CSV
upload checks `plan === GROWTH`. Dark-launched behind `MANNON_FF_ORDERPAD` (basic
paste stays on regardless; the flag gates search, saved lists, and CSV).

## How it works

The pad (`app/routes/portal.quick-order.tsx`) keeps a **client-owned cart**:

- **Search** — type-ahead over the loaded catalog; Enter adds the top match and
  refocuses the box (keyboard-first).
- **Paste** — parsed client-side (`parseSkuQuantityText` + `resolveSkuLines`, now in
  the client-safe `app/lib/quick-order.ts`); unmatched lines are flagged.
- **CSV (Growth)** — posted to the server action, which checks the plan, parses
  (`parseOrderPadCsv`, with a per-line validation summary), resolves against the
  catalog, and returns rows the client merges.
- **AI parse** — the existing Magic Order Pad, merged the same way.
- **Live subtotal** — `orderPadSubtotal` (pure) prices each line at its quantity
  with the F3 resolver, so the buyer sees their price and total savings.

## Saved lists

"Save as list" persists the cart (`SavedOrderList` / `SavedOrderItem`, capped).
"Reorder" fetches a list's items (`/portal/quick-order/list/:id`, ownership-scoped)
and drops them into the cart. A saved list is deep-linkable: `?list=<id>` preloads
it — used by the **reorder email** template (`reorder_list`, editable in Settings).

## Data model (migration `f4_quick_order_pad`)

- `SavedOrderList { companyId, name }`, `SavedOrderItem { listId, variantId, qty }`.
- Event `ORDERPAD_USED` (append-only) on quote submit from the pad.

## Guardrails

Prices shown are the buyer's resolved reference prices; the quote/order still
settles on a Shopify draft order (guardrail #1). Submitting the pad creates a
quote via the existing `submitBuyerQuote` path — nothing is ordered without the
normal quote → accept flow.
