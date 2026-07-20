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

/** Growth-only features (gated behind the Growth plan). See /docs/prd.md §3.7. */
export const GROWTH_FEATURES: GrowthFeature[] = [
  {
    key: "quote-copilot",
    name: "Quote Copilot",
    description: "AI-drafted counter-offers and pricing suggestions in your inbox.",
  },
  {
    key: "reorder-radar",
    name: "Reorder Radar",
    description: "Automatic nudges when a buyer is due to place their next order.",
  },
];
