# Feature 11 — Custom Catalogs & Per-Customer Product Visibility

Show each buyer (or company / group) only the products they're allowed to see.
Powers exclusive lines, tiered assortments, and hidden wholesale-only SKUs.
Dark-launched behind `MANNON_FF_CUSTOM_CATALOGS`; when off, every buyer sees the
full catalog exactly as before.

## Plan availability

| Capability | Starter | Growth |
|---|---|---|
| Custom catalogs | 1 | Unlimited |
| Company-level assignment | ✓ | ✓ |
| Group (customer tag) + member assignment | — | ✓ |
| CSV bulk import | — | ✓ |

Gated by `PLAN_LIMITS.customCatalogCap`, `catalogAssignmentScopes(plan)`, and
`catalogCsvAllowed(plan)` (`app/lib/billing.ts`).

## Resolution order (the core — one place)

`app/lib/catalog-visibility.ts` is pure and unit-tested:

- **`resolveCatalogId`** — member override > company > group (any matching
  customer tag) > store default. Returns null when nothing applies (→ unrestricted).
- **`buildVisibility`** — turns a catalog + its items into a fast lookup:
  - `ASSIGNED` → **deny-by-default**: only allowed products/variants are visible.
  - `ALL` → everything except items flagged `hidden`.
  - A `hidden` entry always wins over an allow entry.
- **`isVisible` / `filterVisible`** — the guard used everywhere. Hidden items are
  **removed**, never greyed.

## Visibility-leak guarantees

A hidden SKU must never reach a buyer it isn't assigned to. Enforcement is
centralized in `getVisibleCatalog(shopDomain, { buyerId, companyId })`
(`app/services/catalogs.server.ts`), which every buyer-facing product read goes
through:

1. **Portal quote builder** (`portal.quotes.new`) — list + submit.
2. **Order pad** (`portal.quick-order`) — search, paste, CSV, AI parse, and submit.
3. **Reorder** (`portal.reorder.$sourceId`) — a hidden SKU on a past order won't
   reappear in the cart.
4. **Quote submission** (`submitBuyerQuote`) matches only against the filtered
   catalog, so a **directly-submitted hidden variant id is rejected** — the
   line-item picker and direct-URL cases collapse to the same guard.

Because the buyer never receives an unfiltered catalog, there is no client-side
list, autocomplete, or picker that could reveal a hidden SKU. Resolution is
cached per `(shop, buyer)` for `VISIBILITY_CACHE_TTL_MS` and invalidated on any
catalog/assignment edit.

## Preview as customer

`previewVisibleCatalog(shopDomain, { companyId | memberId | groupTag })` runs the
**same** resolution as the live buyer path, so the merchant's "preview as
customer" split view is exactly what the buyer will see — no separate code path
to drift.

## Data model (migration `f11_custom_catalogs`)

- `Catalog { name, isDefault, visibility }`
- `CatalogItem { productId, variantId?, hidden }` — unique `(catalog, product, variant)`.
- `CatalogAssignment { companyId?, customerGroupTag?, memberId? }` — one target per row.
- Event `CATALOG_ASSIGNED` (ids only, no PII).

## Reconciliation / notes

- The fetched catalog now carries `productId` (added to `catalog.server.ts`) so
  whole-product allow/hide entries work, not just per-variant.
- **Group (customer tag) membership per buyer** isn't synced from Shopify yet, so
  the portal path resolves with an empty tag set — company/member assignment fully
  drives visibility (covers the acceptance criteria). Group assignment resolves
  when a tag is supplied and is previewable by tag. Per-buyer tag sync is a
  documented follow-up (mirrors the F3 tag model).
- No new Shopify OAuth scope. CSV columns: `product_id,variant_id,hidden`.
