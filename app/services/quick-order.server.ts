import type { CatalogItem } from "./catalog.server";
import type {
  ParsedRow,
  ResolvedLine,
  ResolveResult,
  UnresolvedRow,
} from "../lib/quick-order";

export type {
  ParsedRow,
  ResolvedLine,
  ResolveResult,
  UnresolvedReason,
  UnresolvedRow,
} from "../lib/quick-order";
export { UNRESOLVED_MESSAGE } from "../lib/quick-order";

/**
 * Quick-order pad (F3). Deterministic SKU + quantity resolution against the
 * catalog. This is the base that AI-1 (S12) sits on: the AI proposes SKUs, and
 * they flow through exactly this resolver, so an unknown SKU is always flagged
 * inline — never silently dropped or invented.
 */

/**
 * Parse pasted text into SKU + quantity rows. Tolerant of separators: comma,
 * tab, semicolon, or whitespace. A trailing integer is the quantity; with no
 * quantity, defaults to 1.
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

function normalize(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * Resolve SKU rows against the catalog. Every row lands in exactly one bucket:
 * a resolved cart line, or an unresolved row carrying the reason it couldn't be
 * matched. Nothing is dropped.
 */
export function resolveSkuLines(
  rows: ParsedRow[],
  catalog: CatalogItem[],
): ResolveResult {
  const bySku = new Map<string, CatalogItem>();
  for (const item of catalog) {
    if (item.sku) bySku.set(normalize(item.sku), item);
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
    const item = bySku.get(normalize(row.sku));
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
