import type { CatalogVisibility } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { getCatalog, type CatalogItem as ShopCatalogItem } from "./catalog.server";
import {
  resolveCatalogId,
  buildVisibility,
  filterVisible,
  type AssignmentLite,
  type ResolvedVisibility,
} from "../lib/catalog-visibility";
import {
  getPlanLimits,
  catalogAssignmentScopes,
  catalogCsvAllowed,
  evaluateCatalogAllowance,
  type CatalogAssignmentScope,
} from "../lib/billing";

/**
 * F11 — Custom Catalogs & Per-Customer Product Visibility. Merchant CRUD for
 * catalogs/items/assignments, plus the buyer-facing resolution + filtering that
 * enforces deny-by-default visibility across the portal, order pad, and quote
 * builder. Pure resolution logic lives in app/lib/catalog-visibility.ts.
 *
 * Dark-launched behind MANNON_FF_CUSTOM_CATALOGS: when off, getVisibleCatalog
 * returns the full catalog unchanged so nothing changes for existing buyers.
 */

export const CATALOGS_ENABLED = () => process.env.MANNON_FF_CUSTOM_CATALOGS === "true";

export class CatalogCapError extends Error {}
export class ScopeNotAllowedError extends Error {}
export class NotFoundError extends Error {}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}

// --- merchant CRUD -----------------------------------------------------------

export interface CatalogRow {
  id: string;
  name: string;
  isDefault: boolean;
  visibility: CatalogVisibility;
  itemCount: number;
  assignmentCount: number;
}

export async function listCatalogs(shopDomain: string): Promise<CatalogRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.catalog.findMany({
    where: { shopId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { items: true, assignments: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    isDefault: c.isDefault,
    visibility: c.visibility,
    itemCount: c._count.items,
    assignmentCount: c._count.assignments,
  }));
}

export async function countCustomCatalogs(shopId: string): Promise<number> {
  return prisma.catalog.count({ where: { shopId, isDefault: false } });
}

export async function createCatalog(
  shopDomain: string,
  input: { name: string; visibility: CatalogVisibility; isDefault?: boolean },
  plan: string | null,
): Promise<string> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new NotFoundError("Unknown shop");

  if (!input.isDefault) {
    const used = await countCustomCatalogs(shopId);
    const cap = getPlanLimits(plan).customCatalogCap;
    if (!evaluateCatalogAllowance(used, cap).allowed) {
      throw new CatalogCapError("Custom catalog cap reached");
    }
  }
  const catalog = await prisma.catalog.create({
    data: {
      shopId,
      name: input.name.trim() || "Untitled catalog",
      visibility: input.visibility,
      isDefault: input.isDefault ?? false,
    },
  });
  return catalog.id;
}

async function assertOwned(shopDomain: string, catalogId: string): Promise<string> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new NotFoundError("Unknown shop");
  const cat = await prisma.catalog.findFirst({ where: { id: catalogId, shopId }, select: { id: true } });
  if (!cat) throw new NotFoundError("Catalog not found");
  return shopId;
}

export async function renameCatalog(shopDomain: string, catalogId: string, name: string): Promise<void> {
  await assertOwned(shopDomain, catalogId);
  await prisma.catalog.update({ where: { id: catalogId }, data: { name: name.trim() || "Untitled catalog" } });
}

export async function setVisibility(shopDomain: string, catalogId: string, visibility: CatalogVisibility): Promise<void> {
  await assertOwned(shopDomain, catalogId);
  await prisma.catalog.update({ where: { id: catalogId }, data: { visibility } });
  clearVisibilityCache();
}

export async function deleteCatalog(shopDomain: string, catalogId: string): Promise<void> {
  await assertOwned(shopDomain, catalogId);
  await prisma.catalog.delete({ where: { id: catalogId } });
  clearVisibilityCache();
}

export interface CatalogDetail {
  id: string;
  name: string;
  isDefault: boolean;
  visibility: CatalogVisibility;
  items: Array<{ id: string; productId: string; variantId: string | null; hidden: boolean }>;
  assignments: Array<{ id: string; companyId: string | null; customerGroupTag: string | null; memberId: string | null }>;
}

export async function getCatalogDetail(shopDomain: string, catalogId: string): Promise<CatalogDetail | null> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const cat = await prisma.catalog.findFirst({
    where: { id: catalogId, shopId },
    include: { items: true, assignments: true },
  });
  if (!cat) return null;
  return {
    id: cat.id,
    name: cat.name,
    isDefault: cat.isDefault,
    visibility: cat.visibility,
    items: cat.items.map((i) => ({ id: i.id, productId: i.productId, variantId: i.variantId, hidden: i.hidden })),
    assignments: cat.assignments.map((a) => ({ id: a.id, companyId: a.companyId, customerGroupTag: a.customerGroupTag, memberId: a.memberId })),
  };
}

// --- items -------------------------------------------------------------------

/**
 * Upsert a catalog item by its natural key. Done via findFirst rather than a
 * compound-unique upsert because `variantId` is nullable (whole-product entries),
 * and Prisma can't match NULL through a unique WHERE.
 */
async function upsertItem(
  catalogId: string,
  item: { productId: string; variantId: string | null; hidden: boolean },
): Promise<void> {
  const existing = await prisma.catalogItem.findFirst({
    where: { catalogId, productId: item.productId, variantId: item.variantId },
    select: { id: true },
  });
  if (existing) {
    await prisma.catalogItem.update({ where: { id: existing.id }, data: { hidden: item.hidden } });
  } else {
    await prisma.catalogItem.create({ data: { catalogId, ...item } });
  }
}

export async function addCatalogItem(
  shopDomain: string,
  catalogId: string,
  item: { productId: string; variantId: string | null; hidden: boolean },
): Promise<void> {
  await assertOwned(shopDomain, catalogId);
  await upsertItem(catalogId, item);
  clearVisibilityCache();
}

export async function removeCatalogItem(shopDomain: string, catalogId: string, itemId: string): Promise<void> {
  await assertOwned(shopDomain, catalogId);
  await prisma.catalogItem.deleteMany({ where: { id: itemId, catalogId } });
  clearVisibilityCache();
}

/**
 * Replace a catalog's item set from the builder's checkbox grid. In an ASSIGNED
 * catalog the checked variants are allow entries (hidden=false); in an ALL
 * catalog they're block entries (hidden=true). Reconciles in one transaction.
 */
export async function replaceCatalogItems(
  shopDomain: string,
  catalogId: string,
  checked: Array<{ productId: string; variantId: string | null }>,
  hidden: boolean,
): Promise<void> {
  await assertOwned(shopDomain, catalogId);
  await prisma.$transaction([
    prisma.catalogItem.deleteMany({ where: { catalogId } }),
    prisma.catalogItem.createMany({
      data: checked.map((c) => ({ catalogId, productId: c.productId, variantId: c.variantId, hidden })),
      skipDuplicates: true,
    }),
  ]);
  clearVisibilityCache();
}

// --- CSV ---------------------------------------------------------------------

export interface CsvItemRow {
  productId: string;
  variantId: string | null;
  hidden: boolean;
}

export const CATALOG_CSV_TEMPLATE = "product_id,variant_id,hidden\n";

/** Parse a `product_id,variant_id,hidden` CSV. Pure. Blank variant = whole product. */
export function parseCatalogCsv(text: string): { rows: CsvItemRow[]; errors: string[] } {
  const rows: CsvItemRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    if (i === 0 && /product_id/i.test(line)) continue; // header
    const [productId, variantId, hidden] = line.split(",").map((c) => c.trim());
    if (!productId) {
      errors.push(`Line ${i + 1}: missing product_id`);
      continue;
    }
    rows.push({
      productId,
      variantId: variantId || null,
      hidden: /^(1|true|yes|hidden)$/i.test(hidden ?? ""),
    });
  }
  return { rows, errors };
}

export async function importCatalogCsv(
  shopDomain: string,
  catalogId: string,
  rows: CsvItemRow[],
  plan: string | null,
): Promise<number> {
  await assertOwned(shopDomain, catalogId);
  if (!catalogCsvAllowed(plan)) throw new ScopeNotAllowedError("CSV import needs Growth");
  let n = 0;
  for (const r of rows) {
    await upsertItem(catalogId, { productId: r.productId, variantId: r.variantId, hidden: r.hidden });
    n++;
  }
  clearVisibilityCache();
  return n;
}

// --- assignments -------------------------------------------------------------

export async function assignCatalog(
  shopDomain: string,
  input: { catalogId: string; scope: CatalogAssignmentScope; targetId: string },
  plan: string | null,
): Promise<void> {
  const shopId = await assertOwned(shopDomain, input.catalogId);
  if (!catalogAssignmentScopes(plan).includes(input.scope)) {
    throw new ScopeNotAllowedError(`${input.scope} assignment needs Growth`);
  }
  const data = {
    catalogId: input.catalogId,
    companyId: input.scope === "COMPANY" ? input.targetId : null,
    customerGroupTag: input.scope === "GROUP" ? input.targetId : null,
    memberId: input.scope === "MEMBER" ? input.targetId : null,
  };
  await prisma.catalogAssignment.create({ data });
  clearVisibilityCache();

  await appendEvent({
    shopId,
    type: "CATALOG_ASSIGNED",
    entityType: "Catalog",
    entityId: input.catalogId,
    // ids only — no PII (guardrail #6).
    payload: { scope: input.scope, targetId: input.targetId },
  });
}

export async function removeAssignment(shopDomain: string, catalogId: string, assignmentId: string): Promise<void> {
  await assertOwned(shopDomain, catalogId);
  await prisma.catalogAssignment.deleteMany({ where: { id: assignmentId, catalogId } });
  clearVisibilityCache();
}

// --- buyer resolution + filtering (the enforcement boundary) -----------------

interface CacheEntry {
  v: ResolvedVisibility;
  expiresAt: number;
}
const visCache = new Map<string, CacheEntry>();
export const VISIBILITY_CACHE_TTL_MS = 60 * 1000;

export function clearVisibilityCache(key?: string): void {
  if (key) visCache.delete(key);
  else visCache.clear();
}

export interface BuyerCtx {
  buyerId: string;
  companyId: string;
  groupTags?: string[];
}

/**
 * Resolve the buyer's applicable visibility (member > company > group > default),
 * cached per (shop, buyer) for a short TTL so repeated portal loads are cheap.
 */
export async function resolveVisibilityForBuyer(
  shopDomain: string,
  ctx: BuyerCtx,
  now: number = Date.now(),
): Promise<ResolvedVisibility> {
  const cacheKey = `${shopDomain}:${ctx.buyerId}`;
  const cached = visCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.v;

  const v = await computeVisibility(shopDomain, {
    memberId: ctx.buyerId,
    companyId: ctx.companyId,
    groupTags: ctx.groupTags ?? [],
  });
  visCache.set(cacheKey, { v, expiresAt: now + VISIBILITY_CACHE_TTL_MS });
  return v;
}

async function computeVisibility(
  shopDomain: string,
  ctx: { memberId: string; companyId: string; groupTags: string[] },
): Promise<ResolvedVisibility> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return buildVisibility(null, []);

  const [assignmentRows, defaultCatalog] = await Promise.all([
    prisma.catalogAssignment.findMany({
      where: { catalog: { shopId } },
      select: { catalogId: true, companyId: true, customerGroupTag: true, memberId: true },
    }),
    prisma.catalog.findFirst({ where: { shopId, isDefault: true }, select: { id: true } }),
  ]);

  const assignments: AssignmentLite[] = assignmentRows;
  const catalogId = resolveCatalogId(assignments, ctx, defaultCatalog?.id ?? null);
  if (!catalogId) return buildVisibility(null, []); // unrestricted

  const catalog = await prisma.catalog.findUnique({
    where: { id: catalogId },
    select: { id: true, visibility: true, items: true },
  });
  if (!catalog) return buildVisibility(null, []);
  return buildVisibility(
    { id: catalog.id, visibility: catalog.visibility },
    catalog.items.map((i) => ({ productId: i.productId, variantId: i.variantId, hidden: i.hidden })),
  );
}

/**
 * The full catalog a buyer may see. Flag off → the complete catalog unchanged.
 * This is THE enforcement point: the portal, order pad, reorder, and quote
 * builder all read products through here, so a hidden SKU can't leak via the
 * list, the picker, or a submitted variant id.
 */
export async function getVisibleCatalog(shopDomain: string, ctx: BuyerCtx): Promise<ShopCatalogItem[]> {
  const full = await getCatalog(shopDomain);
  if (!CATALOGS_ENABLED()) return full;
  const v = await resolveVisibilityForBuyer(shopDomain, ctx);
  if (v.mode === "open") return full;
  return filterVisible(full, v);
}

// --- merchant "preview as customer" ------------------------------------------

export interface PreviewTarget {
  companyId?: string;
  memberId?: string;
  groupTag?: string;
}

/**
 * What a given customer would see: the resolved visible catalog for a preview
 * target. Uses the same resolution as the live buyer path, so preview == reality.
 */
export async function previewVisibleCatalog(
  shopDomain: string,
  target: PreviewTarget,
): Promise<{ items: ShopCatalogItem[]; total: number }> {
  const full = await getCatalog(shopDomain);

  let companyId = target.companyId ?? "";
  let memberId = target.memberId ?? "";
  if (target.memberId) {
    const buyer = await prisma.buyer.findUnique({ where: { id: target.memberId }, select: { companyId: true } });
    if (buyer) companyId = buyer.companyId;
  }
  const v = await computeVisibility(shopDomain, {
    memberId,
    companyId,
    groupTags: target.groupTag ? [target.groupTag] : [],
  });
  const items = v.mode === "open" ? full : filterVisible(full, v);
  return { items, total: full.length };
}
