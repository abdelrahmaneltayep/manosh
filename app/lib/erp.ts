// F15 — pure ERP-sync logic. No Prisma, no network, no credentials: stock
// reconciliation, the oversell guard, the normalized outbound order payload, and
// inbound-payload parsing all live here and are unit-tested. The retry/backoff +
// digest helpers are shared with F10 (imported from ./accounting), so both syncs
// behave identically. The service (erp.server.ts) does the DB + network work.

export {
  backoffDelayMs,
  shouldRetry,
  nextStatusAfterAttempt,
  summarizeForDigest,
  SYNC_MAX_ATTEMPTS,
} from "./accounting";

export type ErpKind = "WEBHOOK" | "SFTP" | "NETSUITE" | "CUSTOM";
export type StockSource = "SHOPIFY" | "ERP";
export type SyncDirection = "INBOUND_STOCK" | "OUTBOUND_ORDER";

export const ERP_KINDS: Array<{ id: ErpKind; name: string }> = [
  { id: "WEBHOOK", name: "Webhook / HTTP" },
  { id: "SFTP", name: "CSV over SFTP" },
  { id: "NETSUITE", name: "NetSuite" },
  { id: "CUSTOM", name: "Custom connector" },
];

export function erpKindName(k: ErpKind): string {
  return ERP_KINDS.find((x) => x.id === k)?.name ?? k;
}

// --- inbound stock reconciliation --------------------------------------------

export interface StockUpdate {
  variantId: string;
  qty: number;
}

/**
 * Parse an inbound stock payload (JSON array or a `variant_id,qty` CSV) into
 * clean updates. Skips malformed rows. Pure.
 */
export function parseStockUpdates(payload: unknown): { updates: StockUpdate[]; errors: string[] } {
  const updates: StockUpdate[] = [];
  const errors: string[] = [];

  const pushRow = (variantId: unknown, qty: unknown, where: string) => {
    const v = String(variantId ?? "").trim();
    const q = Math.trunc(Number(qty));
    if (!v) return errors.push(`${where}: missing variant id`);
    if (!Number.isFinite(q)) return errors.push(`${where}: bad qty`);
    updates.push({ variantId: v, qty: Math.max(0, q) });
  };

  if (typeof payload === "string") {
    const lines = payload.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const [i, line] of lines.entries()) {
      if (i === 0 && /variant/i.test(line) && /qty|quantity|available/i.test(line)) continue; // header
      const [variantId, qty] = line.split(",").map((c) => c.trim());
      pushRow(variantId, qty, `Line ${i + 1}`);
    }
  } else if (Array.isArray(payload)) {
    payload.forEach((row, i) => {
      const r = row as Record<string, unknown>;
      pushRow(r.variantId ?? r.variant_id ?? r.sku, r.qty ?? r.quantity ?? r.available, `Row ${i + 1}`);
    });
  } else {
    errors.push("Unrecognized stock payload");
  }
  return { updates, errors };
}

/**
 * Resolve the authoritative quantity for a variant given the configured source
 * of truth. When ERP is the source, an inbound ERP value wins; when Shopify is
 * the source, the ERP value is advisory (cached) but Shopify's number governs
 * overselling. Pure.
 */
export function resolveStock(
  sourceOfTruth: StockSource,
  shopifyQty: number | null,
  erpQty: number | null,
): { qty: number | null; governing: StockSource } {
  if (sourceOfTruth === "ERP") {
    return { qty: erpQty ?? shopifyQty, governing: "ERP" };
  }
  return { qty: shopifyQty ?? erpQty, governing: "SHOPIFY" };
}

export interface OversellResult {
  ok: boolean;
  available: number | null;
  requested: number;
  shortfall: number;
}

/**
 * The oversell guard: never let a line exceed the governing available quantity.
 * A null `available` means we have no stock signal for that variant → allow
 * (don't block on missing data). Pure.
 */
export function oversellCheck(available: number | null, requested: number): OversellResult {
  if (available == null) return { ok: true, available: null, requested, shortfall: 0 };
  const shortfall = Math.max(0, requested - available);
  return { ok: shortfall === 0, available, requested, shortfall };
}

/** Buyer-facing copy when a line is blocked for insufficient stock. Pure. */
export function oversellMessage(sku: string | null, available: number, requested: number): string {
  const label = sku ? `“${sku}”` : "an item";
  return `Only ${available} of ${label} are in stock (you asked for ${requested}). Please lower the quantity to continue.`;
}

// --- outbound order export ---------------------------------------------------

export interface NormalizedOrderLine {
  sku: string | null;
  variantId: string;
  quantity: number;
  unitPrice: string;
}

export interface NormalizedOrder {
  reference: string;
  localId: string;
  company: string;
  currency: string;
  total: string;
  placedAt: string; // ISO
  poNumber: string | null;
  lines: NormalizedOrderLine[];
}

export interface RawOrder {
  id: string;
  companyName: string;
  currency: string;
  total: string;
  placedAt: Date;
  poReference: string | null;
  lines: Array<{ sku: string | null; variantId: string; quantity: number; price: string }>;
}

/**
 * Build the provider-agnostic order payload a connector serializes to the ERP.
 * Money is a snapshot (Shopify owns it) — this only reshapes. Pure.
 */
export function normalizeOrder(raw: RawOrder): NormalizedOrder {
  return {
    reference: `MANNON-${raw.id.slice(-8).toUpperCase()}`,
    localId: raw.id,
    company: raw.companyName,
    currency: raw.currency,
    total: raw.total,
    placedAt: raw.placedAt.toISOString(),
    poNumber: raw.poReference,
    lines: raw.lines.map((l) => ({ sku: l.sku, variantId: l.variantId, quantity: l.quantity, unitPrice: l.price })),
  };
}

// --- sync-lag alerting -------------------------------------------------------

/** Has the last successful sync drifted past the allowed lag (minutes)? Pure. */
export function syncLagExceeded(lastSyncAt: Date | null, now: Date = new Date(), maxMinutes = 120): boolean {
  if (!lastSyncAt) return false; // never synced yet — not "lagging"
  return now.getTime() - lastSyncAt.getTime() > maxMinutes * 60 * 1000;
}
