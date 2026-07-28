// F11 — pure product-visibility logic. No Prisma, no network: resolution order,
// deny-by-default filtering, and the direct-URL guard all live here and are
// unit-tested. The service (catalogs.server.ts) does the DB reads + caching.

export type Visibility = "ALL" | "ASSIGNED";

export interface CatalogLite {
  id: string;
  visibility: Visibility;
}

export interface CatalogItemLite {
  productId: string;
  variantId: string | null; // null = whole product
  hidden: boolean;
}

export interface AssignmentLite {
  catalogId: string;
  companyId: string | null;
  customerGroupTag: string | null;
  memberId: string | null;
}

export interface BuyerContext {
  memberId: string;
  companyId: string;
  groupTags: string[]; // Shopify customer tags / segments the buyer belongs to
}

/**
 * Resolve which catalog applies to a buyer, most specific first:
 * member override > company > group (any matching tag) > store default.
 * Returns the catalogId, or null when nothing is assigned and there's no
 * default (caller treats null as "unrestricted"). Pure.
 */
export function resolveCatalogId(
  assignments: AssignmentLite[],
  ctx: BuyerContext,
  defaultCatalogId: string | null = null,
): string | null {
  const member = assignments.find((a) => a.memberId && a.memberId === ctx.memberId);
  if (member) return member.catalogId;

  const company = assignments.find((a) => a.companyId && a.companyId === ctx.companyId);
  if (company) return company.catalogId;

  const group = assignments.find(
    (a) => a.customerGroupTag && ctx.groupTags.includes(a.customerGroupTag),
  );
  if (group) return group.catalogId;

  return defaultCatalogId;
}

/**
 * The resolved visibility for a catalog: a fast-lookup structure the filter and
 * the direct-URL guard both use. `mode`:
 *  - "open"  — no catalog resolved → everything visible (nothing to hide).
 *  - "allow" — ASSIGNED, deny-by-default: only allowSet is visible.
 *  - "block" — ALL, allow everything except the hidden blockSet.
 */
export interface ResolvedVisibility {
  mode: "open" | "allow" | "block";
  /** Products whose every variant is allowed (a whole-product allow entry). */
  allowWholeProducts: Set<string>;
  /** Specific variants allowed. */
  allowVariants: Set<string>;
  blockProducts: Set<string>;
  blockVariants: Set<string>;
}

export function buildVisibility(
  catalog: CatalogLite | null,
  items: CatalogItemLite[],
): ResolvedVisibility {
  const allowWholeProducts = new Set<string>();
  const allowVariants = new Set<string>();
  const blockProducts = new Set<string>();
  const blockVariants = new Set<string>();

  if (!catalog) {
    return { mode: "open", allowWholeProducts, allowVariants, blockProducts, blockVariants };
  }

  for (const item of items) {
    if (item.hidden) {
      if (item.variantId) blockVariants.add(item.variantId);
      else blockProducts.add(item.productId);
    } else if (item.variantId) {
      allowVariants.add(item.variantId);
    } else {
      allowWholeProducts.add(item.productId);
    }
  }

  return {
    mode: catalog.visibility === "ASSIGNED" ? "allow" : "block",
    allowWholeProducts,
    allowVariants,
    blockProducts,
    blockVariants,
  };
}

/**
 * Is a specific product/variant visible under a resolved visibility? This is the
 * guard used for direct-URL access and the quote line-item picker — deny-by-
 * default in "allow" mode. Pure.
 */
export function isVisible(
  v: ResolvedVisibility,
  target: { productId: string; variantId: string | null },
): boolean {
  const { productId, variantId } = target;

  if (v.mode === "open") return true;

  // A block always wins, in either mode.
  if (variantId && v.blockVariants.has(variantId)) return false;
  if (v.blockProducts.has(productId)) return false;

  // ALL catalog: everything not explicitly blocked is visible.
  if (v.mode === "block") return true;

  // ASSIGNED catalog: deny by default — must be explicitly allowed.
  if (v.allowWholeProducts.has(productId)) return true;
  if (variantId && v.allowVariants.has(variantId)) return true;
  return false;
}

/**
 * Filter a list of catalog rows (each carrying productId + variantId) to only
 * those visible to the buyer. Used by the portal, order pad, and quote builder.
 * Pure and generic over the row shape.
 */
export function filterVisible<T extends { productId: string; variantId: string | null }>(
  rows: T[],
  v: ResolvedVisibility,
): T[] {
  if (v.mode === "open") return rows;
  return rows.filter((r) => isVisible(v, { productId: r.productId, variantId: r.variantId }));
}
