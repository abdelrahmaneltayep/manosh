/**
 * Catalog reads for the buyer portal. The portal is non-embedded and
 * authenticated by magic-link, so it reads the merchant catalog through the
 * shop's stored OFFLINE session (`unauthenticated.admin`).
 *
 * Reads are cached in-memory with a short TTL so repeated portal loads don't
 * re-hit the Admin API (p95 < 500ms). Prices shown here are reference only —
 * the real money is settled on the draft order in S8, never computed by us.
 */

export interface CatalogItem {
  variantId: string; // gid://shopify/ProductVariant/...
  productId: string; // gid://shopify/Product/... (F11 visibility filtering)
  productTitle: string;
  variantTitle: string | null;
  displayTitle: string;
  sku: string | null;
  price: string; // reference price, as a string
  currencyCode: string;
}

// Cache TTL. Short enough that catalog edits show quickly, long enough to
// absorb a burst of portal loads.
export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

// Confirm field names against the current Admin API via the Shopify Dev MCP
// before relying on this in production.
const CATALOG_QUERY = `#graphql
  query MannonCatalog {
    shop { currencyCode }
    products(first: 100, query: "status:active") {
      nodes {
        id
        title
        variants(first: 50) {
          nodes {
            id
            sku
            title
            price
          }
        }
      }
    }
  }
`;

interface RawVariant {
  id: string;
  sku: string | null;
  title: string;
  price: string;
}
interface RawCatalogData {
  shop?: { currencyCode?: string };
  products?: { nodes?: Array<{ id?: string; title: string; variants?: { nodes?: RawVariant[] } }> };
}

/** Pure mapping from the Admin GraphQL response to flat catalog items. */
export function mapProductsToCatalog(data: RawCatalogData): CatalogItem[] {
  const currencyCode = data.shop?.currencyCode ?? "USD";
  const items: CatalogItem[] = [];
  for (const product of data.products?.nodes ?? []) {
    for (const variant of product.variants?.nodes ?? []) {
      const variantTitle =
        variant.title && variant.title !== "Default Title" ? variant.title : null;
      items.push({
        variantId: variant.id,
        productId: product.id ?? "",
        productTitle: product.title,
        variantTitle,
        displayTitle: variantTitle
          ? `${product.title} — ${variantTitle}`
          : product.title,
        sku: variant.sku ?? null,
        price: variant.price,
        currencyCode,
      });
    }
  }
  return items;
}

export async function fetchCatalogFromShopify(shop: string): Promise<CatalogItem[]> {
  // Lazy import so the pure mapping/cache helpers stay testable without booting
  // the Shopify app (which requires env like SHOPIFY_APP_URL at module load).
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(CATALOG_QUERY);
  const body = (await response.json()) as { data?: RawCatalogData };
  return mapProductsToCatalog(body.data ?? {});
}

interface CacheEntry {
  items: CatalogItem[];
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

/**
 * Get a shop's catalog, served from cache when fresh. `loader` is injectable so
 * the caching behaviour is testable without hitting Shopify.
 */
export async function getCatalog(
  shop: string,
  options: {
    loader?: () => Promise<CatalogItem[]>;
    now?: number;
    ttlMs?: number;
  } = {},
): Promise<CatalogItem[]> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? CATALOG_CACHE_TTL_MS;
  const cached = cache.get(shop);
  if (cached && cached.expiresAt > now) {
    return cached.items;
  }
  const loader = options.loader ?? (() => fetchCatalogFromShopify(shop));
  const items = await loader();
  cache.set(shop, { items, expiresAt: now + ttlMs });
  return items;
}

/** Test/util helper: drop cached catalog(s). */
export function clearCatalogCache(shop?: string): void {
  if (shop) cache.delete(shop);
  else cache.clear();
}
