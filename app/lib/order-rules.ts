// F9 — client-safe, pure order-rule logic: resolve the most-specific rule for a
// line, round up to pack multiples / MOQ (never silently), and evaluate the whole
// cart against the store minimum. Used identically in the portal cart, the F4
// order pad, and quote→order conversion. Unit-tested (the acceptance hinges here).

export type RuleScope = "STORE" | "COLLECTION" | "PRODUCT" | "CUSTOMER_GROUP";

export interface OrderRuleLite {
  scope: RuleScope;
  targetId: string | null;
  minQty: number | null;
  packSize: number | null;
  minOrderValue: number | null;
  priority: number;
}

export interface LineContext {
  variantId: string;
  companyId?: string | null;
  collectionIds?: string[];
}

/** Higher = more specific. Product beats group beats collection beats store. */
const SPECIFICITY: Record<RuleScope, number> = {
  PRODUCT: 4,
  CUSTOMER_GROUP: 3,
  COLLECTION: 2,
  STORE: 1,
};

export function ruleMatches(rule: OrderRuleLite, ctx: LineContext): boolean {
  switch (rule.scope) {
    case "STORE":
      return true;
    case "PRODUCT":
      return !!rule.targetId && rule.targetId === ctx.variantId;
    case "CUSTOMER_GROUP":
      return !!rule.targetId && !!ctx.companyId && rule.targetId === ctx.companyId;
    case "COLLECTION":
      return !!rule.targetId && (ctx.collectionIds ?? []).includes(rule.targetId);
  }
}

/** Rules matching a context, most-specific first (tie → higher priority). */
export function matchingRules(rules: OrderRuleLite[], ctx: LineContext): OrderRuleLite[] {
  return rules
    .filter((r) => ruleMatches(r, ctx))
    .sort((a, b) => SPECIFICITY[b.scope] - SPECIFICITY[a.scope] || b.priority - a.priority);
}

/** The most-specific matching rule that sets a given field, or null. */
function firstWith(rules: OrderRuleLite[], field: "minQty" | "packSize" | "minOrderValue"): OrderRuleLite | null {
  for (const r of rules) if (r[field] != null) return r;
  return null;
}

export function roundUpToMultiple(qty: number, multiple: number): number {
  if (!Number.isFinite(multiple) || multiple <= 1) return qty;
  return Math.ceil(qty / multiple) * multiple;
}

export interface LineAdjustment {
  variantId: string;
  requestedQty: number;
  finalQty: number;
  changed: boolean;
  reason: string | null;
  packSize: number | null;
  minQty: number | null;
}

/**
 * Adjust one line's quantity to satisfy the most-specific matching MOQ + pack
 * rule. Rounds UP to the pack multiple and enforces the minimum, then re-rounds
 * so the minimum also lands on a pack boundary. Pure. Never returns < requested.
 */
export function adjustLine(
  requestedQty: number,
  rules: OrderRuleLite[],
  ctx: LineContext,
): LineAdjustment {
  const matched = matchingRules(rules, ctx);
  const packRule = firstWith(matched, "packSize");
  const minRule = firstWith(matched, "minQty");
  const packSize = packRule?.packSize ?? null;
  const minQty = minRule?.minQty ?? null;

  let q = Math.max(0, Math.floor(requestedQty));
  if (minQty && q < minQty) q = minQty;
  if (packSize && packSize > 1) q = roundUpToMultiple(q, packSize);

  const changed = q !== requestedQty;
  let reason: string | null = null;
  if (changed) {
    if (packSize && packSize > 1 && minQty && requestedQty < minQty) {
      reason = `minimum ${minQty}, sold in cases of ${packSize} — rounded to ${q}`;
    } else if (packSize && packSize > 1) {
      reason = `sold in cases of ${packSize} — rounded to ${q}`;
    } else if (minQty) {
      reason = `minimum order of ${minQty} — raised to ${q}`;
    }
  }
  return { variantId: ctx.variantId, requestedQty, finalQty: q, changed, reason, packSize, minQty };
}

export interface CartLineInput {
  variantId: string;
  qty: number;
  price: number;
  collectionIds?: string[];
}

export interface CartEvaluation {
  lines: LineAdjustment[];
  subtotal: number;
  minOrderValue: number | null;
  shortfall: number;
  /** True when the cart clears the store minimum (lines are never dropped). */
  ok: boolean;
}

/**
 * Evaluate a whole cart: adjust each line, sum the adjusted subtotal, and check
 * it against the most-specific applicable order-value minimum. Pure.
 */
export function evaluateCart(
  lines: CartLineInput[],
  rules: OrderRuleLite[],
  ctx: { companyId?: string | null } = {},
): CartEvaluation {
  const adjusted = lines.map((l) =>
    adjustLine(l.qty, rules, { variantId: l.variantId, companyId: ctx.companyId, collectionIds: l.collectionIds }),
  );
  const subtotal = adjusted.reduce((s, a, i) => s + a.finalQty * lines[i].price, 0);

  // Cart-level minimum: the most-specific matching rule (store/group) with a value.
  const cartMatches = matchingRules(rules, { variantId: "__cart__", companyId: ctx.companyId });
  const minRule = firstWith(cartMatches, "minOrderValue");
  const minOrderValue = minRule?.minOrderValue ?? null;
  const shortfall = minOrderValue != null ? Math.max(0, minOrderValue - subtotal) : 0;

  return { lines: adjusted, subtotal, minOrderValue, shortfall, ok: shortfall === 0 };
}

/** Buyer-facing shortfall copy. */
export function shortfallMessage(currency: string, shortfall: number, minOrderValue: number): string {
  return `Add ${currency} ${shortfall.toFixed(2)} more to meet the ${currency} ${minOrderValue.toFixed(2)} minimum order.`;
}
