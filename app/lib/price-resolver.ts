// F3 — the price resolver. Client-safe and PURE so it's used identically on the
// server (quote/order time) and in the buyer portal (to show "you save X%"), and
// so its precedence can be unit-tested hard.
//
// Precedence, highest first:
//   1. volume break  — the highest minQty break that the quantity reaches
//   2. list-entry     — the customer's per-variant price-list price
//   3. default        — the Shopify list price
//
// This is deliberately strict: an applicable volume break wins even if a plain
// list entry happens to be cheaper, because a break is the explicit "at this
// quantity, charge this" rule the merchant set.

export type PriceSource = "volume" | "list-entry" | "default";

export interface VolumeBreakInput {
  minQty: number;
  price: number;
}

export interface ResolveInput {
  /** Default (Shopify) unit price — the fallback and the "list price" we save against. */
  listPrice: number;
  /** The customer's price-list entry for this variant, if any. */
  entryPrice?: number | null;
  /** Volume breaks for this variant within the customer's list. */
  breaks?: VolumeBreakInput[] | null;
}

export interface ResolvedPrice {
  price: number;
  source: PriceSource;
  listPrice: number;
  /** (listPrice − price) / listPrice, clamped to ≥ 0; 0 when listPrice ≤ 0. */
  savedPct: number;
}

/** Pick the applicable volume break for a quantity, or null. Pure. */
export function pickVolumeBreak(
  quantity: number,
  breaks: VolumeBreakInput[] | null | undefined,
): VolumeBreakInput | null {
  if (!breaks || breaks.length === 0) return null;
  const applicable = breaks.filter(
    (b) => Number.isFinite(b.minQty) && b.minQty > 0 && quantity >= b.minQty,
  );
  if (applicable.length === 0) return null;
  // Highest minQty wins; on a tie, the lowest price wins (best for the buyer,
  // and deterministic).
  return applicable.reduce((best, b) => {
    if (b.minQty > best.minQty) return b;
    if (b.minQty === best.minQty && b.price < best.price) return b;
    return best;
  });
}

function savedPct(listPrice: number, price: number): number {
  if (!Number.isFinite(listPrice) || listPrice <= 0) return 0;
  return Math.max(0, (listPrice - price) / listPrice);
}

/** Resolve the effective unit price for a variant at a given quantity. Pure. */
export function resolvePrice(quantity: number, input: ResolveInput): ResolvedPrice {
  const listPrice = input.listPrice;
  const brk = pickVolumeBreak(quantity, input.breaks);
  if (brk) {
    return { price: brk.price, source: "volume", listPrice, savedPct: savedPct(listPrice, brk.price) };
  }
  if (input.entryPrice != null && Number.isFinite(input.entryPrice)) {
    return {
      price: input.entryPrice,
      source: "list-entry",
      listPrice,
      savedPct: savedPct(listPrice, input.entryPrice),
    };
  }
  return { price: listPrice, source: "default", listPrice, savedPct: 0 };
}
