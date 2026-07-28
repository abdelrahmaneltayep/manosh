// Client-safe billing constants + pure gating logic. Kept out of
// billing.server.ts so route components can reference plan names, pricing, and
// gating (planMeets/featureAccess) in render without pulling server-only code
// (Prisma, the Shopify SDK) into the client bundle.

// Plan names are the keys Shopify stores against the subscription; keep them
// stable — changing a key orphans existing subscriptions.
export const STARTER_PLAN = "Starter";
export const GROWTH_PLAN = "Growth";

export type PlanName = typeof STARTER_PLAN | typeof GROWTH_PLAN;

export const TRIAL_DAYS = 14;

/** Display pricing, also the source of truth for the billing charge. */
export const PLAN_PRICING = {
  [STARTER_PLAN]: { amount: 29, currencyCode: "USD" as const },
  [GROWTH_PLAN]: { amount: 79, currencyCode: "USD" as const },
};

export interface BillingStatus {
  /** The active PAID plan, or null when on trial / no active payment. */
  plan: PlanName | null;
  /** Whether Shopify reports any active payment for the store. */
  hasActivePayment: boolean;
  /** True while no paid subscription is active (trial period or lapsed). */
  onTrial: boolean;
  /** The raw active subscription name, if any (for logging/telemetry). */
  activeSubscriptionName: string | null;
  /** The active subscription's Shopify id — needed to cancel it. */
  activeSubscriptionId: string | null;
}

// --- plan gating -------------------------------------------------------------

/** Higher rank includes everything below it. Growth ⊃ Starter. */
export const PLAN_RANK: Record<PlanName, number> = {
  [STARTER_PLAN]: 1,
  [GROWTH_PLAN]: 2,
};

/** Does the current plan satisfy (meet or exceed) the required plan? Pure. */
export function planMeets(current: PlanName | null, required: PlanName): boolean {
  if (!current) return false;
  return PLAN_RANK[current] >= PLAN_RANK[required];
}

export type AccessReason = "ok" | "no-plan" | "upgrade-required";

export interface FeatureAccess {
  allowed: boolean;
  reason: AccessReason;
  required: PlanName;
}

/** Pure gating decision for a feature that needs `required`. */
export function featureAccess(
  status: BillingStatus,
  required: PlanName,
): FeatureAccess {
  if (!status.plan) return { allowed: false, reason: "no-plan", required };
  if (!planMeets(status.plan, required)) {
    return { allowed: false, reason: "upgrade-required", required };
  }
  return { allowed: true, reason: "ok", required };
}

export interface GrowthFeature {
  key: string;
  name: string;
  description: string;
}

/**
 * No feature is locked behind Growth. Every feature (quote builder, portal, net
 * terms, AI Order Pad, reorder) is available on both paid tiers. The tiers
 * differ ONLY on enforceable limits (see PLAN_LIMITS below). Kept as an empty
 * exported array so existing importers don't break.
 */
export const GROWTH_FEATURES: GrowthFeature[] = [];

// --- plan limits (the real Starter vs Growth difference) ---------------------

export interface PlanLimits {
  /** Rolling cap of active quotes per 30-day window. Infinity = unlimited. */
  activeQuoteCap: number;
  /** Maximum staff seats for the store. */
  seatCap: number;
  /** F3: maximum number of price lists. Infinity = unlimited. */
  priceListCap: number;
}

/** How far back the "active quotes" window looks. */
export const ACTIVE_QUOTE_WINDOW_DAYS = 30;

export const PLAN_LIMITS = {
  starter: { activeQuoteCap: 50, seatCap: 1, priceListCap: 3 },
  growth: { activeQuoteCap: Infinity, seatCap: 5, priceListCap: Infinity },
} as const satisfies Record<"starter" | "growth", PlanLimits>;

/**
 * Limits for a plan. Accepts the Prisma `Plan` enum ("GROWTH"/"STARTER"/…) or a
 * PlanName ("Growth"/"Starter"). Only Growth gets the higher limits; Starter,
 * trial, cancelled, and unknown all fall back to Starter limits.
 */
export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return plan === "GROWTH" || plan === GROWTH_PLAN
    ? PLAN_LIMITS.growth
    : PLAN_LIMITS.starter;
}

export interface QuoteAllowance {
  allowed: boolean;
  used: number;
  cap: number;
}

/** Pure allowance decision: a new quote is allowed while used < cap. */
export function evaluateQuoteAllowance(used: number, cap: number): QuoteAllowance {
  return { allowed: used < cap, used, cap };
}

export interface SeatAllowance {
  allowed: boolean;
  used: number;
  cap: number;
}

/** Merchant-facing copy when the quote cap is hit (they can upgrade). */
export function quoteCapMessage(cap: number): string {
  return `You've reached your Starter plan limit of ${cap} active quotes this month. Upgrade to Growth for unlimited quotes.`;
}

/** Buyer-facing copy when the store's quote cap is hit (they can't upgrade). */
export const QUOTE_CAP_BUYER_MESSAGE =
  "This store can't take a new quote request right now. Please reach out to them to continue.";

/** Merchant-facing copy when the seat cap is hit. */
export function seatCapMessage(cap: number): string {
  return `Your Starter plan includes ${cap} staff seat. Upgrade to Growth for up to ${PLAN_LIMITS.growth.seatCap} seats.`;
}

/** Pure allowance decision for creating another price list. */
export function evaluatePriceListAllowance(used: number, cap: number): { allowed: boolean; used: number; cap: number } {
  return { allowed: used < cap, used, cap };
}

/** Merchant-facing copy when the price-list cap is hit. */
export function priceListCapMessage(cap: number): string {
  return `Your Starter plan includes ${cap} price lists. Upgrade to Growth for unlimited price lists, volume breaks, and CSV import.`;
}
