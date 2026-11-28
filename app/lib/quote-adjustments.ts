// Quote adjustments on Shopify's draft-order layout: an order discount,
// a shipping line and custom items (no product). Mannon only stores what the
// merchant typed and passes it to Shopify (draftOrderCalculate /
// draftOrderCreate), which does every calculation. Nothing here adds up money.
// Field names confirmed against the Admin GraphQL schema (DraftOrderInput,
// DraftOrderAppliedDiscountInput, ShippingLineInput, DraftOrderLineItemInput).
// Pure and client-safe.

export interface QuoteDiscount {
  valueType: "PERCENTAGE" | "FIXED_AMOUNT";
  /** The number the merchant typed: a percentage, or an amount in the quote currency. */
  value: string;
  /** Shown to the buyer, e.g. "Volume discount". */
  title: string | null;
}

export interface QuoteShipping {
  title: string;
  /** Shipping price as typed; "0" is free shipping. */
  price: string;
}

export interface QuoteCustomItem {
  title: string;
  quantity: number;
  /** Unit price as typed. */
  price: string;
}

export interface QuoteAdjustments {
  discount: QuoteDiscount | null;
  shipping: QuoteShipping | null;
  customItems: QuoteCustomItem[];
}

export const NO_ADJUSTMENTS: QuoteAdjustments = { discount: null, shipping: null, customItems: [] };
export const MAX_CUSTOM_ITEMS = 20;

const MONEY_RE = /^\d{1,9}(\.\d{1,2})?$/;
const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;

const clean = (v: unknown, max = 255) =>
  String(v ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, max);

/** True for a unit price Shopify should charge: a positive amount with at most 2 decimals. */
export function isPositivePrice(value: string): boolean {
  const v = value.trim();
  return MONEY_RE.test(v) && Number(v) > 0;
}

export type ParseResult = { ok: true; adjustments: QuoteAdjustments } | { ok: false; error: string };

/**
 * Read adjustments from the quote form. Fields (all optional):
 *   discountType (PERCENTAGE | FIXED_AMOUNT), discountValue, discountTitle
 *   shippingTitle, shippingPrice
 *   customTitle_N, customQuantity_N, customPrice_N
 */
export function parseAdjustments(form: { get(name: string): unknown; keys(): Iterable<string> }): ParseResult {
  let discount: QuoteDiscount | null = null;
  const discountValue = clean(form.get("discountValue"), 20);
  if (discountValue) {
    const valueType = clean(form.get("discountType")) === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
    if (valueType === "PERCENTAGE") {
      if (!PERCENT_RE.test(discountValue) || Number(discountValue) <= 0 || Number(discountValue) > 100) {
        return { ok: false, error: "Enter a discount between 0 and 100%." };
      }
    } else if (!isPositivePrice(discountValue)) {
      return { ok: false, error: "Enter a discount amount above 0, like 25 or 25.50." };
    }
    discount = { valueType, value: discountValue, title: clean(form.get("discountTitle"), 100) || null };
  }

  let shipping: QuoteShipping | null = null;
  const shippingPrice = clean(form.get("shippingPrice"), 20);
  const shippingTitle = clean(form.get("shippingTitle"), 100);
  if (shippingPrice || shippingTitle) {
    if (!MONEY_RE.test(shippingPrice)) return { ok: false, error: "Enter a shipping price, like 15 or 0 for free shipping." };
    shipping = { title: shippingTitle || "Shipping", price: shippingPrice };
  }

  const indexes = new Set<string>();
  for (const key of form.keys()) {
    const m = /^custom(?:Title|Quantity|Price)_(\d{1,3})$/.exec(key);
    if (m) indexes.add(m[1]);
  }
  const customItems: QuoteCustomItem[] = [];
  for (const i of [...indexes].sort((a, b) => Number(a) - Number(b))) {
    const title = clean(form.get(`customTitle_${i}`), 255);
    const price = clean(form.get(`customPrice_${i}`), 20);
    const quantityRaw = clean(form.get(`customQuantity_${i}`), 9);
    if (!title && !price) continue; // an empty row the merchant didn't fill
    if (!title) return { ok: false, error: "Give each custom item a name." };
    const quantity = Number(quantityRaw || "1");
    if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, error: `Enter a whole quantity of 1 or more for “${title}”.` };
    if (!isPositivePrice(price)) return { ok: false, error: `Enter a price above 0 for “${title}”.` };
    customItems.push({ title, quantity, price });
  }
  if (customItems.length > MAX_CUSTOM_ITEMS) return { ok: false, error: `A quote can have up to ${MAX_CUSTOM_ITEMS} custom items.` };

  return { ok: true, adjustments: { discount, shipping, customItems } };
}

/** Stored adjustments (Quote.adjustments JSON), tolerant of missing or old data. */
export function readAdjustments(raw: unknown): QuoteAdjustments {
  const a = (raw ?? {}) as Partial<QuoteAdjustments>;
  const d = a.discount;
  const s = a.shipping;
  return {
    discount:
      d && (d.valueType === "PERCENTAGE" || d.valueType === "FIXED_AMOUNT") && typeof d.value === "string"
        ? { valueType: d.valueType, value: d.value, title: typeof d.title === "string" ? d.title : null }
        : null,
    shipping: s && typeof s.title === "string" && typeof s.price === "string" ? { title: s.title, price: s.price } : null,
    customItems: Array.isArray(a.customItems)
      ? a.customItems.filter((c): c is QuoteCustomItem => !!c && typeof c.title === "string" && typeof c.price === "string" && Number.isInteger(c.quantity))
      : [],
  };
}

export function hasAdjustments(a: QuoteAdjustments): boolean {
  return Boolean(a.discount || a.shipping || a.customItems.length);
}

/** The DraftOrderInput fields for these adjustments, in Shopify's own shapes. */
export function adjustmentDraftFields(a: QuoteAdjustments, currencyCode: string) {
  return {
    ...(a.discount
      ? {
          appliedDiscount: {
            valueType: a.discount.valueType,
            value: Number(a.discount.value),
            ...(a.discount.title ? { title: a.discount.title } : {}),
          },
        }
      : {}),
    ...(a.shipping ? { shippingLine: { title: a.shipping.title, priceWithCurrency: { amount: a.shipping.price, currencyCode } } } : {}),
    customLineItems: a.customItems.map((c) => ({
      title: c.title,
      quantity: c.quantity,
      originalUnitPriceWithCurrency: { amount: c.price, currencyCode },
    })),
  };
}

// --- reply wording -------------------------------------------------------------

/**
 * The send button's label. Answering a request is "Send quote"; "Send counter"
 * only once the buyer has made an offer of their own to counter.
 */
export function sendLabel(opts: { buyerOffered: boolean }): "Send quote" | "Send counter" {
  return opts.buyerOffered ? "Send counter" : "Send quote";
}

/** Why sending is off, or null when it can be sent. */
export function sendBlockedReason(q: { status: string; expiresAt: string | Date; now?: Date }): string | null {
  const now = q.now ?? new Date();
  if (q.status === "EXPIRED" || new Date(q.expiresAt).getTime() <= now.getTime()) {
    return "This quote has expired, so it can’t be sent. Duplicate it to send a new one.";
  }
  if (q.status !== "SUBMITTED") return "This quote was already sent.";
  return null;
}
