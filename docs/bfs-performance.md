# Built-for-Shopify — Performance (§3.2, PR-5)

BFS grades performance on two surfaces: the **embedded admin** (fast, no layout
shift, App Bridge navigation) and the **storefront** (a theme app extension must
not slow the merchant's theme). This documents each bar, where it's met, and a
re-runnable audit. The internal target is the DoD's **p95 < 500ms** per primary
interaction.

## Storefront theme app extensions — async + tiny

Both storefront surfaces (F17 Request-a-Quote, F21 Make-an-Offer) ship as theme
app extensions that **never block the theme**:

- The block loads its script with **`defer`** and its stylesheet via `asset_url`;
  all config + submit calls are **`fetch` after render**. Nothing runs on the
  critical path, and a failed config fetch **fails closed** (no button, zero
  storefront impact).
- Assets are hand-written and small — no framework on the storefront:

  | Asset | Bytes (uncompressed) |
  |---|---|
  | `make-an-offer.js` | ~5.3 KB |
  | `make-an-offer.css` | ~1.5 KB |
  | `quote-widget.js` | ~4.5 KB |
  | `quote-widget.css` | ~1.3 KB |

  Audit: `find extensions -name '*.js' -o -name '*.css' | xargs wc -c`.

- The two public config endpoints (`/api/offer-config`, `/api/quote-widget-config`)
  send **`Cache-Control: public, max-age=60`**, so repeat product-page views hit
  the CDN/browser cache, not the app. Audit: `grep -rn "Cache-Control" app/routes/api.*-config.tsx`.

## Admin — indexed reads, no N+1, batched cost lookups

- **Hot paths are indexed single or batched reads.** The dashboard, quote inbox,
  and offer queue read against composite indexes (`@@index([shopId, status])`,
  `@@index([shopId, createdAt])`), sized to stay under p95 < 500ms.
- **No per-line N+1 on variant cost (fixed in PR-5).** The F21 offer engine
  (`createOffer`, `offerSuggestion`) previously called `getVariantCost` once per
  line — one DB read *and* potentially one Shopify call **per line**. It now calls
  the batched **`getVariantCosts(shop, ids[])`**: one indexed `findMany` for the
  whole set, then a **single** Shopify `nodes()` call for the cache misses. An
  N-line offer went from up to N Shopify round-trips to **one**.
  - `getVariantCost` is now a thin wrapper over the batch (unchanged behavior).
  - Cost is cached per shop/variant (`VariantCost`, 24h TTL); a live-read failure
    serves stale cache and never throws (a scope hiccup can't break a suggestion).
  - Audit (should print nothing): `grep -rn "await getVariantCost\b" app/services/*.ts`
    inside a `for`/`map` — cost reads must be batched before the loop.

## App Bridge navigation, no layout shift

- Navigation uses App Bridge (`@shopify/app-bridge-react` `TitleBar` +
  Polaris `Page`), so the admin frame doesn't full-reload between screens.
- Lists render Polaris `IndexTable`/skeletons with **designed empty + error
  states** (never a blank table that reflows in), keeping CLS low.

## Result

Storefront extensions load async, framework-free, and cache their config ✓ ·
admin hot paths are indexed and free of per-line N+1 (F21 cost lookups batched to
one DB read + one Shopify call) ✓ · App Bridge navigation + designed empty/error
states keep layout stable ✓.
