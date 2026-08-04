import prisma from "../db.server";

/**
 * Cached wholesale cost per variant, pulled from Shopify's
 * `ProductVariant.inventoryItem.unitCost` (needs the read_inventory scope). Used
 * by the AI Quote Assistant so margin math is real, not guessed. Cost is
 * reference-only — the authoritative money is the draft order, never us.
 *
 * The cache is persisted (VariantCost) so it survives restarts and is scoped per
 * shop. A short TTL keeps it fresh without hammering the Admin API.
 */

export const VARIANT_COST_TTL_MS = 24 * 60 * 60 * 1000; // a day; cost changes rarely

export interface VariantCostValue {
  costPrice: number | null;
  currencyCode: string | null;
}

const COST_QUERY = `#graphql
  query MannonVariantCosts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        inventoryItem { unitCost { amount currencyCode } }
      }
    }
  }
`;

interface RawNode {
  id?: string;
  inventoryItem?: { unitCost?: { amount?: string | null; currencyCode?: string | null } | null };
}

/** Pure mapping from the Admin `nodes` response to variantId → cost. */
export function mapVariantCosts(
  data: { nodes?: Array<RawNode | null> } | undefined,
): Map<string, VariantCostValue> {
  const out = new Map<string, VariantCostValue>();
  for (const node of data?.nodes ?? []) {
    if (!node?.id) continue;
    const raw = node.inventoryItem?.unitCost?.amount;
    const amount = raw == null ? null : Number(raw);
    out.set(node.id, {
      costPrice: amount != null && Number.isFinite(amount) ? amount : null,
      currencyCode: node.inventoryItem?.unitCost?.currencyCode ?? null,
    });
  }
  return out;
}

async function fetchVariantCostsFromShopify(
  shopDomain: string,
  variantIds: string[],
): Promise<Map<string, VariantCostValue>> {
  // Lazy import so the pure mapper stays testable without booting Shopify.
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(shopDomain);
  const response = await admin.graphql(COST_QUERY, { variables: { ids: variantIds } });
  const body = (await response.json()) as { data?: { nodes?: Array<RawNode | null> } };
  return mapVariantCosts(body.data);
}

type CostLoader = (
  shopDomain: string,
  variantIds: string[],
) => Promise<Map<string, VariantCostValue>>;

const nullCost: VariantCostValue = { costPrice: null, currencyCode: null };

/**
 * Batched cost lookup — the performance path (§3.2 / p95). One indexed
 * `findMany` for the whole set, then a **single** Shopify `nodes()` call for the
 * misses (never one call per variant). Cache-through: fresh values come from the
 * VariantCost cache, misses are fetched and upserted. A live-read failure serves
 * any stale cached value and never throws, so a scope hiccup can't break the
 * caller. `loader` and `now` are injectable for tests. Returns a map keyed by
 * variantId (unknown ids map to `{ costPrice: null }`).
 */
export async function getVariantCosts(
  shopDomain: string,
  variantIds: string[],
  options: { loader?: CostLoader; now?: number; ttlMs?: number } = {},
): Promise<Map<string, VariantCostValue>> {
  const out = new Map<string, VariantCostValue>();
  const ids = Array.from(new Set(variantIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? VARIANT_COST_TTL_MS;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) {
    for (const id of ids) out.set(id, nullCost);
    return out;
  }

  // One read for the whole set (indexed by [shopId, variantId]).
  const cachedRows = await prisma.variantCost.findMany({
    where: { shopId: shop.id, variantId: { in: ids } },
    select: { variantId: true, costPrice: true, currencyCode: true, updatedAt: true },
  });
  const cachedById = new Map(cachedRows.map((r) => [r.variantId, r]));
  const asValue = (r: { costPrice: unknown; currencyCode: string | null }): VariantCostValue => ({
    costPrice: r.costPrice == null ? null : Number(r.costPrice),
    currencyCode: r.currencyCode,
  });

  const stale: string[] = [];
  for (const id of ids) {
    const c = cachedById.get(id);
    if (c && now - c.updatedAt.getTime() < ttlMs) out.set(id, asValue(c));
    else stale.push(id);
  }
  if (stale.length === 0) return out;

  // One Shopify call for every miss.
  const loader = options.loader ?? fetchVariantCostsFromShopify;
  let fetched: Map<string, VariantCostValue>;
  try {
    fetched = await loader(shopDomain, stale);
  } catch {
    // Live read failed (e.g. scope not yet granted) — serve any stale cached
    // value, else null. Never throw: cost is reference-only for a suggestion.
    for (const id of stale) {
      const c = cachedById.get(id);
      out.set(id, c ? asValue(c) : nullCost);
    }
    return out;
  }

  for (const id of stale) {
    const value = fetched.get(id) ?? nullCost;
    out.set(id, value);
    await prisma.variantCost.upsert({
      where: { shopId_variantId: { shopId: shop.id, variantId: id } },
      create: { shopId: shop.id, variantId: id, costPrice: value.costPrice, currencyCode: value.currencyCode },
      update: { costPrice: value.costPrice, currencyCode: value.currencyCode },
    });
  }
  return out;
}

/**
 * Get a single variant's cost (thin wrapper over the batched
 * {@link getVariantCosts}). Served from the VariantCost cache when fresh,
 * otherwise fetched from Shopify and cached. Returns `{ costPrice: null }` when
 * Shopify has no cost on file. `loader` and `now` are injectable for tests.
 */
export async function getVariantCost(
  shopDomain: string,
  variantId: string,
  options: { loader?: CostLoader; now?: number; ttlMs?: number } = {},
): Promise<VariantCostValue> {
  const map = await getVariantCosts(shopDomain, [variantId], options);
  return map.get(variantId) ?? nullCost;
}
