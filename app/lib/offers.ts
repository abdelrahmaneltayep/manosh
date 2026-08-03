// F21 — Make an Offer rule engine (pure). Reuses the SAME margin idea as the F1
// counter (margin = (revenue − cost) / revenue against the F3/variant-cost
// baseline) — no second pricing brain. Money is integer cents; percentages are
// fractions (0.75 = 75%), matching the Decimal(5,4) columns.
//
// THE INVARIANT (§2.5): the margin floor always wins — the engine never
// auto-accepts or auto-counters to a price whose margin is below the rule's
// marginFloorPct. When it can't stay above the floor automatically, it falls back
// to manual review.

export type OfferAction = "decline" | "accept" | "counter" | "manual";

export interface OfferRuleLite {
  id: string;
  scope: "ALL" | "COLLECTION" | "PRODUCT" | "CUSTOMER_GROUP";
  scopeRef: string | null;
  minAcceptPctOfList: number; // fraction
  autoDeclineBelowPctOfList: number; // fraction
  autoCounterToPctOfList: number | null; // fraction
  marginFloorPct: number; // fraction
  priority: number;
  active: boolean;
}

export interface OfferMatchContext {
  variantIds: string[];
  productIds?: string[];
  collectionIds?: string[];
  customerGroup?: string | null;
}

/** Gross margin as a fraction. 0 (or negative-safe) when revenue ≤ 0. Pure. */
export function marginPct(revenueCents: number, costCents: number): number {
  if (revenueCents <= 0) return 0;
  return (revenueCents - costCents) / revenueCents;
}

/** The smallest price (cents) whose margin against `costCents` clears `floor`. Pure.
 *  Rounds UP (safe direction), with a sub-cent epsilon to absorb float error. */
export function floorPriceCents(costCents: number, floor: number): number {
  if (floor >= 1) return Number.POSITIVE_INFINITY; // 100%+ margin is unreachable with a real cost
  return Math.ceil(costCents / (1 - floor) - 1e-6);
}

/** Does a rule apply to this offer context? Pure. */
export function ruleMatches(rule: OfferRuleLite, ctx: OfferMatchContext): boolean {
  if (!rule.active) return false;
  switch (rule.scope) {
    case "ALL":
      return true;
    case "PRODUCT":
      return !!rule.scopeRef && (ctx.variantIds.includes(rule.scopeRef) || (ctx.productIds ?? []).includes(rule.scopeRef));
    case "COLLECTION":
      return !!rule.scopeRef && (ctx.collectionIds ?? []).includes(rule.scopeRef);
    case "CUSTOMER_GROUP":
      return !!rule.scopeRef && !!ctx.customerGroup && rule.scopeRef === ctx.customerGroup;
  }
}

const SPECIFICITY: Record<OfferRuleLite["scope"], number> = {
  PRODUCT: 4,
  CUSTOMER_GROUP: 3,
  COLLECTION: 2,
  ALL: 1,
};

/** The highest-priority matching rule (ties broken by specificity then id). Pure. */
export function pickRule(rules: OfferRuleLite[], ctx: OfferMatchContext): OfferRuleLite | null {
  const matched = rules.filter((r) => ruleMatches(r, ctx));
  if (matched.length === 0) return null;
  matched.sort(
    (a, b) =>
      b.priority - a.priority ||
      SPECIFICITY[b.scope] - SPECIFICITY[a.scope] ||
      a.id.localeCompare(b.id),
  );
  return matched[0];
}

export interface OfferEconomics {
  listCents: number;
  offeredCents: number;
  costCents: number;
}

export interface OfferDecision {
  action: OfferAction;
  /** Set when action === "counter": the counter total in cents (≥ floor price). */
  counterCents?: number;
  /** Margin (fraction) at the buyer's offered price. */
  marginAtOffer: number;
  reason: string;
}

/**
 * Decide how to handle an offer given the matching rule. Decision order (§2.2):
 * auto-decline → auto-accept (margin-checked) → auto-counter (clamped to the
 * floor) → manual. The margin floor overrides everything.
 */
export function evaluateOffer(econ: OfferEconomics, rule: OfferRuleLite | null): OfferDecision {
  const { listCents, offeredCents, costCents } = econ;
  const marginAtOffer = marginPct(offeredCents, costCents);

  if (!rule) return { action: "manual", marginAtOffer, reason: "No matching rule — manual review." };
  if (listCents <= 0) return { action: "manual", marginAtOffer, reason: "No list price — manual review." };

  const offeredPct = offeredCents / listCents;
  const floorOk = (cents: number) => marginPct(cents, costCents) >= rule.marginFloorPct;

  // 1. Auto-decline — too far below list.
  if (offeredPct < rule.autoDeclineBelowPctOfList) {
    return { action: "decline", marginAtOffer, reason: "Below the auto-decline threshold." };
  }

  // 2. Auto-accept — at/above the accept threshold AND margin clears the floor.
  if (offeredPct >= rule.minAcceptPctOfList) {
    if (floorOk(offeredCents)) {
      return { action: "accept", marginAtOffer, reason: "At/above the accept threshold with margin intact." };
    }
    // Would accept, but the margin floor forbids it → don't auto-commit.
  }

  // 3. Auto-counter — to the configured %, but never below the floor price.
  if (rule.autoCounterToPctOfList != null) {
    const target = Math.round(listCents * rule.autoCounterToPctOfList);
    const floorPrice = floorPriceCents(costCents, rule.marginFloorPct);
    const counterCents = Math.min(listCents, Math.max(target, floorPrice));
    // If even list price can't clear the floor (cost ≥ list), there's nothing safe to counter.
    if (!floorOk(counterCents)) {
      return { action: "manual", marginAtOffer, reason: "Can't counter above the margin floor — manual review." };
    }
    return { action: "counter", counterCents, marginAtOffer, reason: "Auto-countered, clamped to the margin floor." };
  }

  // 4. Otherwise a human decides.
  return { action: "manual", marginAtOffer, reason: "Between decline and accept thresholds — manual review." };
}
