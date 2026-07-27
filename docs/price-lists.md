# Feature 3 — Customer-Specific Price Lists & Volume Pricing

Assign per-customer / per-group prices and quantity breaks so buyers see the right
price without discount codes.

## Plan limits

| Capability | Starter | Growth |
|---|---|---|
| Price lists | up to **3** | unlimited |
| Per-variant list prices | ✓ | ✓ |
| Volume breaks | — | ✓ |
| CSV import | — | ✓ |
| CSV export + template | ✓ | ✓ |
| Assign by company | ✓ | ✓ |
| Auto-apply by customer tag | — | ✓ |

`PLAN_LIMITS.priceListCap` (`app/lib/billing.ts`) = 3 (Starter) / ∞ (Growth). The
4th-list creation and CSV import call the Growth gate. Dark-launched behind
`MANNON_FF_PRICELISTS`.

## The resolver (the core)

`app/lib/price-resolver.ts` — pure, client-safe, and heavily unit-tested. Precedence,
highest first:

1. **volume break** — the highest `minQty` break the quantity reaches (ties → lowest price)
2. **list-entry** — the customer's per-variant price
3. **default** — the Shopify list price

Edge cases covered by tests: no list, tie qty, missing entry, break below/at minQty,
non-positive minQty, entry above list (savedPct clamps to 0), zero list price.

Used identically server-side (quote/order time) and in the buyer portal, which shows
`resolvePrice(...).savedPct` as a **"You save X%"** badge.

## Data model (migration `f3_price_lists`)

- `PriceList` (shop-scoped, name + currency), `PriceListEntry` (per-variant price),
  `VolumeBreak` (per-variant `minQty` → price).
- `CompanyPriceList` — one list per company.
- `PriceListTag` — Shopify customer tag → list, for auto-apply on signup
  (`listIdForTags` resolves it; wire it into the company-creation hook).
- Event `PRICELIST_ASSIGNED`.

## Bulk editor + CSV

- Editor: `/app/price-lists/:id` — `IndexTable` of entries + breaks with add/update
  and delete.
- CSV format: `variant_id,price,min_qty` (a row with `min_qty` is a volume break,
  without it a fixed entry). `parseEntriesCsv` returns validated rows + a per-line
  error summary (pure, tested). Export + template: `/app/price-lists/:id/csv`.

## Buyer experience

The portal quote builder (`portal.quotes.new`) resolves each catalog item against
the company's assigned list and shows the list price struck through, the custom
price, and the savings badge. Volume-pricing availability is hinted per line.

## Notes

- Prices here are **reference** for the buyer; money is still settled on the draft
  order by Shopify (guardrail #1). The merchant's counter/accept uses the resolved
  price as the line price, and Shopify calculates tax/totals.
