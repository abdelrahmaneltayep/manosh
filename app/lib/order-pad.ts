// F4 — client-safe helpers for the order pad: CSV parsing (with a per-line
// validation summary) and the live subtotal, which reuses the F3 price resolver
// so what the buyer sees matches quote/order time.

import { resolvePrice, type VolumeBreakInput } from "./price-resolver";

export const ORDER_CSV_TEMPLATE = "sku,qty\n";

export interface OrderCsvRow {
  sku: string;
  qty: number;
}
export interface OrderCsvResult {
  rows: OrderCsvRow[];
  errors: string[];
}

/**
 * Parse an order CSV: header `sku,qty` (optional), then one `sku,qty` per line.
 * Returns validated rows + a per-line error summary. Pure.
 */
export function parseOrderPadCsv(text: string): OrderCsvResult {
  const rows: OrderCsvRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { rows, errors: ["The file is empty."] };

  let start = 0;
  if (/sku/i.test(lines[0]) && /qty|quantity/i.test(lines[0])) start = 1;

  for (let i = start; i < lines.length; i++) {
    const [sku, qtyRaw] = lines[i].split(/[,\t;]/).map((c) => c.trim());
    const lineNo = i + 1;
    if (!sku) {
      errors.push(`Line ${lineNo}: missing SKU.`);
      continue;
    }
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty < 1) {
      errors.push(`Line ${lineNo}: quantity "${qtyRaw ?? ""}" must be a whole number ≥ 1.`);
      continue;
    }
    rows.push({ sku, qty });
  }
  return { rows, errors };
}

export interface PricedLine {
  quantity: number;
  listPrice: number;
  entryPrice?: number | null;
  breaks?: VolumeBreakInput[] | null;
}

export interface Subtotal {
  subtotal: number;
  listSubtotal: number;
  saved: number;
}

/**
 * Live subtotal for the order pad: for each line, resolve the unit price at its
 * quantity (volume break > list entry > default) and sum. Also returns the
 * subtotal at list price and the saving. Pure.
 */
export function orderPadSubtotal(lines: PricedLine[]): Subtotal {
  let subtotal = 0;
  let listSubtotal = 0;
  for (const line of lines) {
    const qty = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0;
    const { price } = resolvePrice(qty || 1, {
      listPrice: line.listPrice,
      entryPrice: line.entryPrice ?? null,
      breaks: line.breaks ?? null,
    });
    subtotal += price * qty;
    listSubtotal += line.listPrice * qty;
  }
  return { subtotal, listSubtotal, saved: Math.max(0, listSubtotal - subtotal) };
}
