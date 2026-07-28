// F16 — pure currency logic: FX conversion (no floats — integer minor units),
// display-price resolution (contract override > conversion > base), the
// single-currency-per-quote guard, and rate-lock resolution. No Prisma, no
// network — unit-tested. Mannon never settles money (Shopify does); conversion
// here is PRESENTATION of an agreed price, and a quote LOCKS its rate at issue.

export type RateMap = Map<string, string>; // key `${base}>${quote}` -> rate string

export function rateKey(base: string, quote: string): string {
  return `${base}>${quote}`;
}

/**
 * Resolve the FX rate from base to quote. Same currency → "1". Otherwise the
 * stored rate, else null (caller shows base currency + a "no rate" state). Pure.
 */
export function resolveRate(base: string, quote: string, rates: RateMap): string | null {
  if (base === quote) return "1";
  return rates.get(rateKey(base, quote)) ?? null;
}

/** Convert an amount by a rate, cents-safe. Returns a 2-dp string. Pure. */
export function convertAmount(amount: string | number, rate: string | number): string {
  const a = typeof amount === "number" ? amount : Number(amount);
  const r = typeof rate === "number" ? rate : Number(rate);
  if (!Number.isFinite(a) || !Number.isFinite(r)) return "0.00";
  // Work in integer cents on the source, multiply by the rate, round once.
  const cents = Math.round(a * 100);
  return (Math.round(cents * r) / 100).toFixed(2);
}

export interface DisplayPrice {
  amount: string;
  currency: string;
  source: "override" | "converted" | "base";
}

/**
 * The price to show a buyer for one line. Precedence:
 *  1) a merchant-set per-currency contract override (exact, no FX),
 *  2) a conversion of the base price at the locked/known rate,
 *  3) the base price in the store currency (no rate available).
 * Pure — the caller supplies the override + rate.
 */
export function resolveDisplayPrice(
  basePrice: string | number,
  baseCurrency: string,
  displayCurrency: string,
  opts: { override?: string | null; rate?: string | null },
): DisplayPrice {
  if (opts.override != null) {
    return { amount: Number(opts.override).toFixed(2), currency: displayCurrency, source: "override" };
  }
  if (baseCurrency === displayCurrency) {
    return { amount: Number(basePrice).toFixed(2), currency: baseCurrency, source: "base" };
  }
  if (opts.rate != null) {
    return { amount: convertAmount(basePrice, opts.rate), currency: displayCurrency, source: "converted" };
  }
  // No rate → fall back cleanly to the store currency (guardrail).
  return { amount: Number(basePrice).toFixed(2), currency: baseCurrency, source: "base" };
}

/**
 * Guardrail: never mix currencies within one quote/order. Returns the single
 * currency, or throws if more than one distinct currency is present. Pure.
 */
export function assertSingleCurrency(currencies: string[]): string {
  const distinct = Array.from(new Set(currencies.filter(Boolean)));
  if (distinct.length > 1) {
    throw new Error(`A quote can't mix currencies: ${distinct.join(", ")}`);
  }
  return distinct[0] ?? "";
}

export interface LockedFx {
  currency: string;
  rate: string;
}

/**
 * Lock the FX for a quote at issue time: the buyer's display currency + the rate
 * from the store base to that currency. Same currency (or no rate) → rate "1" in
 * the base currency, so a counter-offer never drifts with FX. Pure.
 */
export function lockFx(baseCurrency: string, displayCurrency: string, rates: RateMap): LockedFx {
  if (baseCurrency === displayCurrency) return { currency: displayCurrency, rate: "1" };
  const rate = resolveRate(baseCurrency, displayCurrency, rates);
  if (!rate) return { currency: baseCurrency, rate: "1" }; // no rate → stay in base
  return { currency: displayCurrency, rate };
}
