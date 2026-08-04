import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { getCatalog } from "./catalog.server";
import type { CatalogItem } from "./catalog.server";
import { bulkImportRowCap } from "../lib/billing";
import { parseImport, type ImportMode, type ImportRow, type RowIssue } from "../lib/quote-import";

/** Injectable catalog loader (real one hits Shopify; tests pass a stub). */
export type CatalogLoader = (shopDomain: string) => Promise<CatalogItem[]>;

/**
 * F25.3 — bulk CSV import. Two modes: add many products to a single quote
 * ("lines"), or create multiple quotes at once ("quotes"). We validate every row
 * against the live catalog (SKU must resolve) and, for the "quotes" mode, against
 * existing buyers (email must match) — no fabricated companies. The commit is
 * **all-or-nothing**: if any row has an issue we refuse the whole batch, and the
 * writes run inside a single transaction. Growth-gated (row cap per plan). Emits
 * QUOTE_IMPORTED. Line prices come from the CSV when given, else the catalog
 * reference price — we never invent money beyond what's provided.
 */

export class ImportHasErrorsError extends Error {
  constructor() {
    super("The import has errors — fix them and try again. Nothing was saved.");
    this.name = "ImportHasErrorsError";
  }
}

export interface PreviewRow {
  line: number;
  sku: string;
  title: string | null;
  quantity: number;
  price: number | null;
  group?: string;
  email?: string;
  ok: boolean;
  issue?: string;
}

export interface ImportPreview {
  mode: ImportMode;
  rows: PreviewRow[];
  errors: RowIssue[]; // whole-file + per-row, merged
  ok: boolean;
  cap: number;
  quoteCount: number; // "quotes" mode: distinct groups
}

interface Resolved {
  variantBySku: Map<string, { variantId: string; title: string; price: number }>;
  buyerByEmail: Map<string, { buyerId: string; companyId: string }>;
}

async function resolve(shopId: string, shopDomain: string, mode: ImportMode, emails: string[], loadCatalog: CatalogLoader): Promise<Resolved> {
  const catalog = await loadCatalog(shopDomain);
  const variantBySku = new Map<string, { variantId: string; title: string; price: number }>();
  for (const c of catalog) {
    if (c.sku) variantBySku.set(c.sku.trim().toLowerCase(), { variantId: c.variantId, title: c.displayTitle, price: Number(c.price) });
  }
  const buyerByEmail = new Map<string, { buyerId: string; companyId: string }>();
  if (mode === "quotes" && emails.length) {
    const buyers = await prisma.buyer.findMany({
      where: { email: { in: emails }, company: { shopId } },
      select: { id: true, email: true, companyId: true },
    });
    for (const b of buyers) buyerByEmail.set(b.email.trim().toLowerCase(), { buyerId: b.id, companyId: b.companyId });
  }
  return { variantBySku, buyerByEmail };
}

export async function previewImport(
  shopDomain: string,
  text: string,
  mode: ImportMode,
  opts: { plan: string | null; targetQuoteId?: string | null; loadCatalog?: CatalogLoader } = { plan: null },
): Promise<ImportPreview> {
  const loadCatalog = opts.loadCatalog ?? getCatalog;
  const cap = bulkImportRowCap(opts.plan);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  const parsed = parseImport(text, mode);
  const errors: RowIssue[] = [...parsed.errors];

  if (!shop) errors.push({ line: 0, message: "Unknown shop." });
  if (parsed.rows.length > cap) errors.push({ line: 0, message: `Too many rows: ${parsed.rows.length}. The limit is ${cap} per import.` });

  // "lines" mode needs an editable target quote in this shop.
  if (mode === "lines" && shop) {
    if (!opts.targetQuoteId) errors.push({ line: 0, message: "Choose a target quote to add these lines to." });
    else {
      const q = await prisma.quote.findFirst({ where: { id: opts.targetQuoteId, company: { shopId: shop.id } }, select: { status: true } });
      if (!q) errors.push({ line: 0, message: "Target quote not found." });
      else if (q.status !== "SUBMITTED" && q.status !== "COUNTERED") errors.push({ line: 0, message: "The target quote can no longer be edited." });
    }
  }

  const resolved = shop ? await resolve(shop.id, shopDomain, mode, parsed.rows.map((r) => r.email ?? "").filter(Boolean), loadCatalog) : null;

  // Per-group email consistency ("quotes" mode): one buyer per quote group.
  const groupEmail = new Map<string, string>();
  if (mode === "quotes") {
    for (const r of parsed.rows) {
      if (!r.group || !r.email) continue;
      const seen = groupEmail.get(r.group);
      if (seen && seen !== r.email) errors.push({ line: r.line, message: `Quote "${r.group}" has more than one buyer email.` });
      else groupEmail.set(r.group, r.email);
    }
  }

  const perLine = new Map<number, string>();
  for (const e of parsed.errors) if (e.line > 0 && !perLine.has(e.line)) perLine.set(e.line, e.message);

  const rows: PreviewRow[] = parsed.rows.map((r: ImportRow) => {
    const v = resolved?.variantBySku.get(r.sku.trim().toLowerCase());
    let issue = perLine.get(r.line);
    if (!issue && r.sku && !v) issue = "SKU not found in your catalog.";
    if (!issue && mode === "quotes" && r.email && !resolved?.buyerByEmail.get(r.email)) issue = "No wholesale buyer with that email.";
    if (issue && !parsed.errors.some((e) => e.line === r.line)) errors.push({ line: r.line, message: issue });
    return { line: r.line, sku: r.sku, title: v?.title ?? null, quantity: r.quantity, price: r.price, group: r.group, email: r.email, ok: !issue, issue };
  });

  return { mode, rows, errors, ok: errors.length === 0 && rows.length > 0, cap, quoteCount: groupEmail.size };
}

export interface ImportResult {
  createdQuotes: number;
  addedLines: number;
}

export async function commitImport(
  shopDomain: string,
  text: string,
  mode: ImportMode,
  opts: { plan: string | null; targetQuoteId?: string | null; now?: Date; loadCatalog?: CatalogLoader },
): Promise<ImportResult> {
  const loadCatalog = opts.loadCatalog ?? getCatalog;
  const preview = await previewImport(shopDomain, text, mode, opts);
  if (!preview.ok) throw new ImportHasErrorsError();

  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true, quoteExpiryDays: true } });
  if (!shop) throw new ImportHasErrorsError();
  const resolved = await resolve(shop.id, shopDomain, mode, preview.rows.map((r) => r.email ?? "").filter(Boolean), loadCatalog);
  const priceFor = (sku: string, price: number | null) => (price ?? resolved.variantBySku.get(sku.trim().toLowerCase())!.price).toFixed(4);
  const variantFor = (sku: string) => resolved.variantBySku.get(sku.trim().toLowerCase())!.variantId;
  const titleFor = (sku: string) => resolved.variantBySku.get(sku.trim().toLowerCase())!.title;

  let createdQuotes = 0;
  let addedLines = 0;

  await prisma.$transaction(async (tx) => {
    if (mode === "lines") {
      const data = preview.rows.map((r) => ({
        quoteId: opts.targetQuoteId!, variantId: variantFor(r.sku), sku: r.sku, title: titleFor(r.sku), quantity: r.quantity, price: priceFor(r.sku, r.price),
      }));
      await tx.quoteLine.createMany({ data });
      addedLines = data.length;
    } else {
      const now = opts.now ?? new Date();
      const expiresAt = new Date(now.getTime() + shop.quoteExpiryDays * 24 * 60 * 60 * 1000);
      const groups = new Map<string, PreviewRow[]>();
      for (const r of preview.rows) {
        const key = r.group!;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
      }
      for (const [, rows] of groups) {
        const buyer = resolved.buyerByEmail.get(rows[0].email!)!;
        await tx.quote.create({
          data: {
            companyId: buyer.companyId, buyerId: buyer.buyerId, status: "SUBMITTED", source: "IMPORT", expiresAt,
            lines: { create: rows.map((r) => ({ variantId: variantFor(r.sku), sku: r.sku, title: titleFor(r.sku), quantity: r.quantity, price: priceFor(r.sku, r.price) })) },
          },
        });
        createdQuotes++;
      }
    }
  });

  await appendEvent({ shopId: shop.id, type: "QUOTE_IMPORTED", entityType: "Quote", entityId: opts.targetQuoteId ?? null, payload: { mode, createdQuotes, addedLines } });
  return { createdQuotes, addedLines };
}
