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

/**
 * Get a variant's cost for the shop, served from the VariantCost cache when
 * fresh, otherwise fetched from Shopify and cached (cache-through). Returns
 * `{ costPrice: null }` when Shopify has no cost on file. `loader` and `now` are
 * injectable for tests.
 */
export async function getVariantCost(
  shopDomain: string,
  variantId: string,
  options: { loader?: CostLoader; now?: number; ttlMs?: number } = {},
): Promise<VariantCostValue> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? VARIANT_COST_TTL_MS;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) return { costPrice: null, currencyCode: null };

  const cached = await prisma.variantCost.findUnique({
    where: { shopId_variantId: { shopId: shop.id, variantId } },
    select: { costPrice: true, currencyCode: true, updatedAt: true },
  });
  if (cached && now - cached.updatedAt.getTime() < ttlMs) {
    return {
      costPrice: cached.costPrice == null ? null : Number(cached.costPrice),
      currencyCode: cached.currencyCode,
    };
  }

  const loader = options.loader ?? fetchVariantCostsFromShopify;
  let fetched: Map<string, VariantCostValue>;
  try {
    fetched = await loader(shopDomain, [variantId]);
  } catch {
    // If the live read fails (e.g. scope not yet granted), fall back to any
    // stale cached value rather than blowing up the suggestion flow.
    if (cached) {
      return {
        costPrice: cached.costPrice == null ? null : Number(cached.costPrice),
        currencyCode: cached.currencyCode,
      };
    }
    return { costPrice: null, currencyCode: null };
  }

  const value = fetched.get(variantId) ?? { costPrice: null, currencyCode: null };
  await prisma.variantCost.upsert({
    where: { shopId_variantId: { shopId: shop.id, variantId } },
    create: {
      shopId: shop.id,
      variantId,
      costPrice: value.costPrice,
      currencyCode: value.currencyCode,
    },
    update: { costPrice: value.costPrice, currencyCode: value.currencyCode },
  });
  return value;
}
