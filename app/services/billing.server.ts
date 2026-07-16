import { BillingInterval } from "@shopify/shopify-app-remix/server";

/**
 * Billing skeleton (S3). Defines the plans and a read-only `requireBilling`
 * helper that reports the merchant's current plan. Enforcement/gating is
 * deliberately NOT wired here — S17 completes it (billing.require + plan-gated
 * features). See /docs/prd.md §3.7.
 */

// Plan names are the keys Shopify stores against the subscription; keep them
// stable — changing a key orphans existing subscriptions.
export const STARTER_PLAN = "Starter";
export const GROWTH_PLAN = "Growth";

export type PlanName = typeof STARTER_PLAN | typeof GROWTH_PLAN;

export const TRIAL_DAYS = 14;

/** Display pricing, also the source of truth for the billing charge below. */
export const PLAN_PRICING = {
  [STARTER_PLAN]: { amount: 29, currencyCode: "USD" as const },
  [GROWTH_PLAN]: { amount: 79, currencyCode: "USD" as const },
};

// Typed const so the enum member keeps its literal type (`Every30Days`) inside
// the object literals below — otherwise TS widens it to `BillingInterval` and
// the config no longer satisfies shopifyApp's recurring-line-item type.
const EVERY_30_DAYS: BillingInterval.Every30Days = BillingInterval.Every30Days;

/**
 * Passed to shopifyApp({ billing }). One recurring line item per plan, both
 * with a 14-day trial. Confirm current Billing API fields via the Shopify Dev
 * MCP before changing (see CLAUDE.md).
 */
export const BILLING_CONFIG = {
  [STARTER_PLAN]: {
    trialDays: TRIAL_DAYS,
    lineItems: [
      {
        amount: PLAN_PRICING[STARTER_PLAN].amount,
        currencyCode: PLAN_PRICING[STARTER_PLAN].currencyCode,
        interval: EVERY_30_DAYS,
      },
    ],
  },
  [GROWTH_PLAN]: {
    trialDays: TRIAL_DAYS,
    lineItems: [
      {
        amount: PLAN_PRICING[GROWTH_PLAN].amount,
        currencyCode: PLAN_PRICING[GROWTH_PLAN].currencyCode,
        interval: EVERY_30_DAYS,
      },
    ],
  },
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
}

interface SubscriptionLike {
  name: string;
  status: string;
}

/**
 * Pure mapping from a billing.check() result to Mannon's plan view. Kept pure
 * so it is exhaustively unit-testable without hitting Shopify.
 */
export function resolveActivePlan(
  hasActivePayment: boolean,
  appSubscriptions: SubscriptionLike[],
): BillingStatus {
  const active = appSubscriptions.find((sub) => sub.status === "ACTIVE");
  const name = active?.name ?? null;
  const plan =
    name === STARTER_PLAN || name === GROWTH_PLAN ? (name as PlanName) : null;

  return {
    plan,
    hasActivePayment,
    onTrial: !hasActivePayment,
    activeSubscriptionName: name,
  };
}

/** The subset of the authenticate.admin billing context that we depend on. */
export interface BillingLike {
  check: (options: {
    plans: PlanName[];
    isTest: boolean;
  }) => Promise<{ hasActivePayment: boolean; appSubscriptions: SubscriptionLike[] }>;
}

/**
 * Report the merchant's current plan. SKELETON: reads only — it does NOT
 * redirect to a payment/plan-selection screen. Gating is completed in S17.
 *
 * Usage in a route:
 *   const { billing } = await authenticate.admin(request);
 *   const status = await requireBilling(billing);
 */
export async function requireBilling(
  billing: BillingLike,
  options: { isTest?: boolean } = {},
): Promise<BillingStatus> {
  const isTest = options.isTest ?? process.env.NODE_ENV !== "production";
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [STARTER_PLAN, GROWTH_PLAN],
    isTest,
  });
  return resolveActivePlan(hasActivePayment, appSubscriptions);
}
