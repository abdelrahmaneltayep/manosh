import {
  reconcileShopPlan,
  type BillingStatus,
} from "./billing.server";

/**
 * Billing operations that mutate the subscription. Subscribing/upgrading is a
 * single Shopify call (`billing.request`) that always redirects, so it lives
 * inline in the route. Cancelling needs follow-up work (reconcile + funnel
 * event), so it's here with an injectable client for unit tests.
 */

/** The subset of the billing context we need to cancel a subscription. */
export interface BillingCancelLike {
  cancel: (options: {
    subscriptionId: string;
    isTest: boolean;
    prorate?: boolean;
  }) => Promise<unknown>;
}

/**
 * Cancel the shop's active subscription, then reconcile the Shop row to
 * CANCELLED (which appends the PLAN_CANCELLED funnel event). No-ops if there is
 * no active subscription to cancel.
 */
export async function cancelPlan(
  billing: BillingCancelLike,
  shopDomain: string,
  status: BillingStatus,
  options: { isTest?: boolean } = {},
): Promise<{ cancelled: boolean }> {
  if (!status.activeSubscriptionId) return { cancelled: false };

  const isTest = options.isTest ?? process.env.NODE_ENV !== "production";
  await billing.cancel({
    subscriptionId: status.activeSubscriptionId,
    isTest,
    prorate: true,
  });

  // After cancellation Shopify reports no active payment; reconcile records the
  // CANCELLED transition + emits PLAN_CANCELLED.
  await reconcileShopPlan(shopDomain, {
    plan: null,
    hasActivePayment: false,
    onTrial: true,
    activeSubscriptionName: null,
    activeSubscriptionId: null,
  });

  return { cancelled: true };
}
