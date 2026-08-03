// Pricing v3 — the 4-plan ladder (free/starter/growth/scale), priced below the
// mainstream quote-app field. Client-safe + pure so both server gates and UI can
// use it. Additive and flag-gated (MANNON_FF_PLAN_V3): when the flag is off the
// app keeps the legacy 2-plan behaviour in app/lib/billing.ts untouched.
//
// Money rule (CLAUDE.md): never a float — prices are integer cents.
// Grandfathering rule (the non-negotiable): a shop already paying a pre-v3 price
// is NEVER silently raised — its legacy price is honored and its capabilities map
// UP to the equivalent v3 tier.

/** Ordered plan handles — index = rank. These are also the Shopify subscription
 *  names for the v3 ladder; lowercase, so they never collide with the legacy
 *  "Starter"/"Growth" subscription names. */
export const PLANS = ["free", "starter", "growth", "scale"] as const;
export type PlanHandle = (typeof PLANS)[number];

export function planIndex(handle: PlanHandle): number {
  return PLANS.indexOf(handle);
}

/** Does `current` meet or exceed `min` on the ladder? Pure. */
export function meetsPlan(current: PlanHandle, min: PlanHandle): boolean {
  return planIndex(current) >= planIndex(min);
}

export interface PlanPrice {
  monthlyCents: number;
  /** Annual price (2 months free) in cents; null for the free plan. */
  annualCents: number | null;
  trialDays: number;
}

/** §1.1 — the published ladder. Annual = 10× monthly (2 months free). */
export const PLAN_PRICING_V3: Record<PlanHandle, PlanPrice> = {
  free: { monthlyCents: 0, annualCents: null, trialDays: 0 },
  starter: { monthlyCents: 900, annualCents: 9000, trialDays: 14 },
  growth: { monthlyCents: 2900, annualCents: 29000, trialDays: 14 },
  scale: { monthlyCents: 6900, annualCents: 69000, trialDays: 14 },
};

export const PLAN_DISPLAY_NAME: Record<PlanHandle, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

/** Trust message — Mannon is a flat monthly fee, never a per-order commission. */
export const NO_PER_ORDER_FEES_COPY = "No per-order fees, ever — one flat monthly price.";

// --- capability map (§1.3) ---------------------------------------------------

export type MakeAnOfferTier = "teaser" | "manual" | "auto";
export type AnalyticsTier = "basic" | "full" | "deal";

export interface PlanCapabilities {
  /** Quotes + request-a-quote per 30 days. Infinity = unlimited. */
  quotesCap: number;
  quickOrder: boolean;
  /** F5 company accounts. Infinity = unlimited. */
  companyAccountsCap: number;
  /** F3 price lists. Infinity = unlimited. */
  priceListsCap: number;
  /** F1 AI quote counter. */
  aiCounter: boolean;
  /** F21 Make an Offer: teaser / manual+rules / automation+PWYW. */
  makeAnOffer: MakeAnOfferTier;
  /** F21 rule cap (manual tier). Infinity = unlimited (scale). 0 = none. */
  offerRuleCap: number;
  /** F2 net terms + credit. */
  netTerms: boolean;
  /** F13 deposits / pay-by-link. */
  deposits: boolean;
  /** F7 analytics depth. */
  analytics: AnalyticsTier;
  /** F12 sales-rep portal. */
  salesRep: boolean;
  /** F10 accounting sync. */
  accountingSync: boolean;
  /** F20 white-label. */
  whiteLabel: boolean;
}

const I = Infinity;

export const PLAN_CAPABILITIES: Record<PlanHandle, PlanCapabilities> = {
  free: {
    quotesCap: 10, quickOrder: true, companyAccountsCap: 1, priceListsCap: 0,
    aiCounter: false, makeAnOffer: "teaser", offerRuleCap: 0, netTerms: false,
    deposits: false, analytics: "basic", salesRep: false, accountingSync: false, whiteLabel: false,
  },
  starter: {
    quotesCap: I, quickOrder: true, companyAccountsCap: 5, priceListsCap: 1,
    aiCounter: false, makeAnOffer: "teaser", offerRuleCap: 0, netTerms: false,
    deposits: false, analytics: "basic", salesRep: false, accountingSync: false, whiteLabel: false,
  },
  growth: {
    quotesCap: I, quickOrder: true, companyAccountsCap: 25, priceListsCap: 10,
    aiCounter: true, makeAnOffer: "manual", offerRuleCap: 3, netTerms: true,
    deposits: true, analytics: "full", salesRep: false, accountingSync: false, whiteLabel: false,
  },
  scale: {
    quotesCap: I, quickOrder: true, companyAccountsCap: I, priceListsCap: I,
    aiCounter: true, makeAnOffer: "auto", offerRuleCap: I, netTerms: true,
    deposits: true, analytics: "deal", salesRep: true, accountingSync: true, whiteLabel: true,
  },
};

// --- Prisma Plan enum ↔ handle, with grandfathering --------------------------

export type PrismaPlan = "TRIAL" | "FREE" | "STARTER" | "GROWTH" | "SCALE" | "CANCELLED";

/**
 * The v3 capability tier a shop effectively gets. Grandfathering maps a legacy
 * paid shop UP so it never loses ground when the ladder is re-priced:
 *   legacy STARTER ($29)  → growth capabilities
 *   legacy GROWTH  ($79)  → scale  capabilities
 * A fresh (non-legacy) shop maps by its own tier. Trial gets Starter-level
 * capabilities (matching pre-v3 behaviour); cancelled/unknown fall to Free.
 * Pure.
 */
export function effectivePlanHandle(prismaPlan: PrismaPlan | string | null | undefined, legacy = false): PlanHandle {
  if (legacy && prismaPlan === "STARTER") return "growth";
  if (legacy && prismaPlan === "GROWTH") return "scale";
  switch (prismaPlan) {
    case "SCALE": return "scale";
    case "GROWTH": return "growth";
    case "STARTER": return "starter";
    case "FREE": return "free";
    case "TRIAL": return "starter"; // trial grants Starter-level access
    case "CANCELLED":
    default: return "free";
  }
}

export function getPlanCapabilities(prismaPlan: PrismaPlan | string | null | undefined, legacy = false): PlanCapabilities {
  return PLAN_CAPABILITIES[effectivePlanHandle(prismaPlan, legacy)];
}

/** The Prisma Plan enum value a chosen v3 handle persists as. Pure. */
export function prismaPlanForHandle(handle: PlanHandle): PrismaPlan {
  return handle.toUpperCase() as PrismaPlan;
}

// --- grandfathering resolution ------------------------------------------------

export interface GrandfatherDecision {
  legacyPlan: boolean;
  legacyPriceCents: number | null;
  capabilityHandle: PlanHandle;
}

/**
 * Decide grandfathering for a shop already on a pre-v3 subscription when v3 turns
 * on. Legacy Starter/Growth keep their existing price (2900/7900 cents) and are
 * flagged legacy; their capabilities map up (growth/scale). Everyone else is a
 * clean v3 shop. Pure — the caller persists legacyPlan + legacyPriceCents.
 */
export function resolveGrandfather(prismaPlan: PrismaPlan | string | null | undefined): GrandfatherDecision {
  if (prismaPlan === "STARTER") return { legacyPlan: true, legacyPriceCents: 2900, capabilityHandle: "growth" };
  if (prismaPlan === "GROWTH") return { legacyPlan: true, legacyPriceCents: 7900, capabilityHandle: "scale" };
  return { legacyPlan: false, legacyPriceCents: null, capabilityHandle: effectivePlanHandle(prismaPlan, false) };
}

/** Format integer cents as a display price (e.g. 900 → "$9"). Pure. */
export function formatPriceCents(cents: number): string {
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
