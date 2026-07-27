import prisma from "../db.server";
import { appendEvent } from "./events.server";
import type { VolumeBreakInput } from "../lib/price-resolver";

/**
 * F3 — price-list CRUD, assignment, CSV, and the per-company pricing lookup the
 * resolver consumes. All shop-scoped. The price MATH lives in the pure
 * app/lib/price-resolver.ts; this module only fetches and persists.
 */

export class PriceListCapError extends Error {
  constructor(public cap: number) {
    super(`Price-list limit reached (${cap}).`);
    this.name = "PriceListCapError";
  }
}
export class PriceListNotFoundError extends Error {
  constructor() {
    super("Price list not found.");
    this.name = "PriceListNotFoundError";
  }
}

export async function countPriceLists(shopId: string): Promise<number> {
  return prisma.priceList.count({ where: { shopId } });
}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const s = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return s?.id ?? null;
}

export interface PriceListRow {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  entryCount: number;
  breakCount: number;
  companyCount: number;
}

export async function listPriceListsForShop(shopDomain: string): Promise<PriceListRow[]> {
  const lists = await prisma.priceList.findMany({
    where: { shop: { shopifyDomain: shopDomain } },
    include: { _count: { select: { entries: true, breaks: true, companies: true } } },
    orderBy: { createdAt: "asc" },
  });
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    currency: l.currency,
    isDefault: l.isDefault,
    entryCount: l._count.entries,
    breakCount: l._count.breaks,
    companyCount: l._count.companies,
  }));
}

/** Create a list, enforcing the plan cap (throws PriceListCapError). */
export async function createPriceList(
  shopDomain: string,
  input: { name: string; currency: string },
  cap: number,
): Promise<{ id: string }> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new PriceListNotFoundError();
  const count = await countPriceLists(shopId);
  if (count >= cap) throw new PriceListCapError(cap);
  const created = await prisma.priceList.create({
    data: { shopId, name: input.name.trim() || "Untitled list", currency: input.currency || "USD" },
    select: { id: true },
  });
  return created;
}

async function ownedList(shopDomain: string, listId: string) {
  return prisma.priceList.findFirst({ where: { id: listId, shop: { shopifyDomain: shopDomain } } });
}

export async function getPriceListDetail(shopDomain: string, listId: string) {
  const list = await ownedList(shopDomain, listId);
  if (!list) return null;
  const [entries, breaks] = await Promise.all([
    prisma.priceListEntry.findMany({ where: { priceListId: listId }, orderBy: { variantId: "asc" } }),
    prisma.volumeBreak.findMany({ where: { priceListId: listId }, orderBy: [{ variantId: "asc" }, { minQty: "asc" }] }),
  ]);
  return { list, entries, breaks };
}

export async function saveEntry(
  shopDomain: string,
  listId: string,
  variantId: string,
  price: string,
): Promise<void> {
  if (!(await ownedList(shopDomain, listId))) throw new PriceListNotFoundError();
  await prisma.priceListEntry.upsert({
    where: { priceListId_variantId: { priceListId: listId, variantId } },
    create: { priceListId: listId, variantId, price },
    update: { price },
  });
}

export async function deleteEntry(shopDomain: string, listId: string, entryId: string): Promise<void> {
  if (!(await ownedList(shopDomain, listId))) throw new PriceListNotFoundError();
  await prisma.priceListEntry.deleteMany({ where: { id: entryId, priceListId: listId } });
}

export async function saveVolumeBreak(
  shopDomain: string,
  listId: string,
  variantId: string,
  minQty: number,
  price: string,
): Promise<void> {
  if (!(await ownedList(shopDomain, listId))) throw new PriceListNotFoundError();
  await prisma.volumeBreak.upsert({
    where: { priceListId_variantId_minQty: { priceListId: listId, variantId, minQty } },
    create: { priceListId: listId, variantId, minQty, price },
    update: { price },
  });
}

export async function deleteVolumeBreak(shopDomain: string, listId: string, breakId: string): Promise<void> {
  if (!(await ownedList(shopDomain, listId))) throw new PriceListNotFoundError();
  await prisma.volumeBreak.deleteMany({ where: { id: breakId, priceListId: listId } });
}

/** Assign a list to a company + record PRICELIST_ASSIGNED. */
export async function assignCompany(shopDomain: string, companyId: string, listId: string): Promise<void> {
  const [list, company] = await Promise.all([
    ownedList(shopDomain, listId),
    prisma.company.findFirst({ where: { id: companyId, shop: { shopifyDomain: shopDomain } }, select: { id: true, shopId: true } }),
  ]);
  if (!list || !company) throw new PriceListNotFoundError();
  await prisma.companyPriceList.upsert({
    where: { companyId },
    create: { companyId, priceListId: listId },
    update: { priceListId: listId, assignedAt: new Date() },
  });
  await appendEvent({
    shopId: company.shopId,
    type: "PRICELIST_ASSIGNED",
    entityType: "Company",
    entityId: companyId,
    payload: { priceListId: listId },
  });
}

export interface CompanyAssignmentRow {
  id: string;
  name: string;
  assignedListId: string | null;
}

/** Companies for the shop with their currently-assigned list id (if any). */
export async function listCompaniesForAssignment(shopDomain: string): Promise<CompanyAssignmentRow[]> {
  const companies = await prisma.company.findMany({
    where: { shop: { shopifyDomain: shopDomain } },
    include: { priceList: true },
    orderBy: { name: "asc" },
  });
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    assignedListId: c.priceList?.priceListId ?? null,
  }));
}

/** Tag → list mappings for the shop (for the editor UI). */
export async function listTagMappings(shopDomain: string, listId: string): Promise<string[]> {
  const rows = await prisma.priceListTag.findMany({
    where: { priceListId: listId, shop: { shopifyDomain: shopDomain } },
    select: { tag: true },
    orderBy: { tag: "asc" },
  });
  return rows.map((r) => r.tag);
}

export async function unassignCompany(shopDomain: string, companyId: string): Promise<void> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, shop: { shopifyDomain: shopDomain } },
    select: { id: true },
  });
  if (!company) return;
  await prisma.companyPriceList.deleteMany({ where: { companyId } });
}

/** Map a Shopify customer tag → list, for auto-apply on signup. */
export async function saveTagMapping(shopDomain: string, tag: string, listId: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId || !(await ownedList(shopDomain, listId))) throw new PriceListNotFoundError();
  const clean = tag.trim().toLowerCase();
  if (!clean) return;
  await prisma.priceListTag.upsert({
    where: { shopId_tag: { shopId, tag: clean } },
    create: { shopId, tag: clean, priceListId: listId },
    update: { priceListId: listId },
  });
}

/**
 * Resolve which list applies to a new company from its Shopify tags (first match
 * wins, by tag order). Used by the signup auto-apply hook.
 */
export async function listIdForTags(shopId: string, tags: string[]): Promise<string | null> {
  const clean = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return null;
  const mappings = await prisma.priceListTag.findMany({ where: { shopId, tag: { in: clean } } });
  if (mappings.length === 0) return null;
  const byTag = new Map(mappings.map((m) => [m.tag, m.priceListId]));
  for (const t of clean) {
    const id = byTag.get(t);
    if (id) return id;
  }
  return null;
}

export interface CompanyPricing {
  currency: string | null;
  entriesByVariant: Map<string, number>;
  breaksByVariant: Map<string, VolumeBreakInput[]>;
}

/**
 * Load the pricing context for a company's assigned list: per-variant entry
 * prices + volume breaks, ready to feed resolvePrice(). Empty maps when the
 * company has no list.
 */
export async function getCompanyPricing(companyId: string): Promise<CompanyPricing> {
  const assignment = await prisma.companyPriceList.findUnique({
    where: { companyId },
    include: {
      priceList: { include: { entries: true, breaks: true } },
    },
  });
  const entriesByVariant = new Map<string, number>();
  const breaksByVariant = new Map<string, VolumeBreakInput[]>();
  if (!assignment) return { currency: null, entriesByVariant, breaksByVariant };

  for (const e of assignment.priceList.entries) entriesByVariant.set(e.variantId, Number(e.price));
  for (const b of assignment.priceList.breaks) {
    const arr = breaksByVariant.get(b.variantId) ?? [];
    arr.push({ minQty: b.minQty, price: Number(b.price) });
    breaksByVariant.set(b.variantId, arr);
  }
  return { currency: assignment.priceList.currency, entriesByVariant, breaksByVariant };
}

// --- CSV (pure) --------------------------------------------------------------

export const CSV_TEMPLATE = "variant_id,price,min_qty\n";

export interface CsvRow {
  variantId: string;
  price: string;
  minQty: number | null;
}
export interface CsvParseResult {
  rows: CsvRow[];
  errors: string[];
}

const MONEY = /^\d+(\.\d{1,4})?$/;

/**
 * Parse a price-list CSV: header `variant_id,price,min_qty` (min_qty optional).
 * Returns validated rows + a per-line error summary. Pure.
 */
export function parseEntriesCsv(text: string): CsvParseResult {
  const rows: CsvRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { rows, errors: ["The file is empty."] };

  let start = 0;
  if (/variant/i.test(lines[0]) && /price/i.test(lines[0])) start = 1; // skip header

  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const [variantId, price, minQtyRaw] = cols;
    const lineNo = i + 1;
    if (!variantId) {
      errors.push(`Line ${lineNo}: missing variant id.`);
      continue;
    }
    if (!price || !MONEY.test(price)) {
      errors.push(`Line ${lineNo}: price "${price ?? ""}" isn't a valid amount.`);
      continue;
    }
    let minQty: number | null = null;
    if (minQtyRaw) {
      const n = Number(minQtyRaw);
      if (!Number.isInteger(n) || n < 1) {
        errors.push(`Line ${lineNo}: min_qty "${minQtyRaw}" must be a whole number ≥ 1.`);
        continue;
      }
      minQty = n;
    }
    rows.push({ variantId, price, minQty });
  }
  return { rows, errors };
}

/** Import parsed rows into a list: min_qty set → volume break, else entry. */
export async function importCsvRows(shopDomain: string, listId: string, rows: CsvRow[]): Promise<number> {
  if (!(await ownedList(shopDomain, listId))) throw new PriceListNotFoundError();
  let applied = 0;
  for (const row of rows) {
    if (row.minQty != null) {
      await prisma.volumeBreak.upsert({
        where: { priceListId_variantId_minQty: { priceListId: listId, variantId: row.variantId, minQty: row.minQty } },
        create: { priceListId: listId, variantId: row.variantId, minQty: row.minQty, price: row.price },
        update: { price: row.price },
      });
    } else {
      await prisma.priceListEntry.upsert({
        where: { priceListId_variantId: { priceListId: listId, variantId: row.variantId } },
        create: { priceListId: listId, variantId: row.variantId, price: row.price },
        update: { price: row.price },
      });
    }
    applied++;
  }
  return applied;
}

/** Serialise a list's entries + breaks to CSV. */
export function entriesToCsv(
  entries: Array<{ variantId: string; price: string }>,
  breaks: Array<{ variantId: string; price: string; minQty: number }>,
): string {
  const out = [CSV_TEMPLATE.trim()];
  for (const e of entries) out.push(`${e.variantId},${e.price},`);
  for (const b of breaks) out.push(`${b.variantId},${b.price},${b.minQty}`);
  return out.join("\n") + "\n";
}
