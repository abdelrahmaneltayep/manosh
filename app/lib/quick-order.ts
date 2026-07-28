// Client-safe types + copy for the quick-order pad. The resolver logic lives in
// quick-order.server.ts; these are shared with the client route, so they must
// NOT be in a .server module.

export interface ParsedRow {
  sku: string;
  quantity: number;
  /** The original line, for showing back unresolved rows verbatim. */
  raw: string;
}

export interface ResolvedLine {
  variantId: string;
  sku: string;
  title: string;
  quantity: number;
  price: string;
}

export type UnresolvedReason = "missing-sku" | "invalid-quantity" | "unknown-sku";

export interface UnresolvedRow {
  sku: string;
  quantity: number;
  raw: string;
  reason: UnresolvedReason;
}

export interface ResolveResult {
  resolved: ResolvedLine[];
  unresolved: UnresolvedRow[];
}

export const UNRESOLVED_MESSAGE: Record<UnresolvedReason, string> = {
  "missing-sku": "No SKU on this line",
  "invalid-quantity": "Quantity must be a whole number of 1 or more",
  "unknown-sku": "We couldn’t find this SKU in the catalog",
};

// Minimal catalog shape the pure resolver needs (a CatalogItem satisfies it).
export interface CatalogLite {
  variantId: string;
  sku: string | null;
  displayTitle: string;
  price: string;
}

/**
 * Parse pasted text into SKU + quantity rows. Tolerant of separators: comma,
 * tab, semicolon, or whitespace. A trailing integer is the quantity; with no
 * quantity, defaults to 1. Pure — shared by the server action and the client
 * order pad (keyboard-first paste), so it lives in this client-safe module.
 */
export function parseSkuQuantityText(text: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const tokens = line.split(/[\s,;]+/).filter(Boolean);
    let sku = "";
    let quantity = 1;

    if (tokens.length === 1) {
      sku = tokens[0];
    } else {
      const last = tokens[tokens.length - 1];
      if (/^\d+$/.test(last)) {
        quantity = parseInt(last, 10);
        sku = tokens.slice(0, -1).join(" ");
      } else {
        sku = tokens.join(" ");
      }
    }
    rows.push({ sku, quantity, raw: line });
  }
  return rows;
}

function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * Resolve SKU rows against the catalog. Every row lands in exactly one bucket:
 * a resolved cart line, or an unresolved row carrying the reason. Nothing is
 * dropped. Pure.
 */
export function resolveSkuLines(rows: ParsedRow[], catalog: CatalogLite[]): ResolveResult {
  const bySku = new Map<string, CatalogLite>();
  for (const item of catalog) {
    if (item.sku) bySku.set(normalizeSku(item.sku), item);
  }

  const resolved: ResolvedLine[] = [];
  const unresolved: UnresolvedRow[] = [];

  for (const row of rows) {
    if (!row.sku) {
      unresolved.push({ ...row, reason: "missing-sku" });
      continue;
    }
    if (!Number.isInteger(row.quantity) || row.quantity < 1) {
      unresolved.push({ ...row, reason: "invalid-quantity" });
      continue;
    }
    const item = bySku.get(normalizeSku(row.sku));
    if (!item) {
      unresolved.push({ ...row, reason: "unknown-sku" });
      continue;
    }
    resolved.push({
      variantId: item.variantId,
      sku: item.sku ?? row.sku,
      title: item.displayTitle,
      quantity: row.quantity,
      price: item.price,
    });
  }

  return { resolved, unresolved };
}
