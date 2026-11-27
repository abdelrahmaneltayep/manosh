// Which plan each gated feature needs: the one place plan names come from.
//
// Every "is this allowed?" check and every "needs the X plan" message reads
// this map, so a lock screen can never name a different plan than the one that
// actually unlocks the feature, and both agree with the pricing page and the
// App Store listing (checked in plan-features.test.ts). Features the pricing
// table lists are derived from PLAN_CAPABILITIES; the rest are set here.
//
// The shop's tier must come from its stored plan (effectivePlanHandle), not
// from BillingStatus.plan: that older field only knows "Starter" and "Growth"
// and reports a Scale shop as "Growth". Pure, no server code.

import {
  PLANS,
  PLAN_CAPABILITIES,
  PLAN_DISPLAY_NAME,
  effectivePlanHandle,
  meetsPlan,
  type PlanCapabilities,
  type PlanHandle,
} from "./billing-v3";

export type PlanFeature =
  // Listed on the pricing page and the App Store listing.
  | "draftWithClaude"
  | "netTerms"
  | "deposits"
  | "makeAnOffer"
  | "offerAutomation"
  | "fullAnalytics"
  | "dealAnalytics"
  | "salesReps"
  | "accountingSync"
  | "whiteLabel"
  // Not on the pricing page; set by product decision.
  | "agency"
  | "catalogSharing"
  | "priceRules"
  | "priceRuleTargeting";

/** The lowest plan whose capabilities pass `test`. */
function lowestPlanWhere(test: (c: PlanCapabilities) => boolean): PlanHandle {
  const found = PLANS.find((h) => test(PLAN_CAPABILITIES[h]));
  if (!found) throw new Error("No plan includes this feature");
  return found;
}

export const FEATURE_PLAN: Record<PlanFeature, PlanHandle> = {
  draftWithClaude: lowestPlanWhere((c) => c.aiCounter),
  netTerms: lowestPlanWhere((c) => c.netTerms),
  deposits: lowestPlanWhere((c) => c.deposits),
  makeAnOffer: lowestPlanWhere((c) => c.makeAnOffer !== "teaser"),
  offerAutomation: lowestPlanWhere((c) => c.makeAnOffer === "auto"),
  fullAnalytics: lowestPlanWhere((c) => c.analytics !== "basic"),
  dealAnalytics: lowestPlanWhere((c) => c.analytics === "deal"),
  salesReps: lowestPlanWhere((c) => c.salesRep),
  accountingSync: lowestPlanWhere((c) => c.accountingSync),
  whiteLabel: lowestPlanWhere((c) => c.whiteLabel),
  // Agency mode manages and white-labels several stores, so it follows white-label.
  agency: lowestPlanWhere((c) => c.whiteLabel),
  // Owner decision, 27 Nov 2026: price rules from Starter (Free shows them
  // disabled with "Starter" named); targeting by tag, product or collection
  // from Growth.
  priceRules: "starter",
  priceRuleTargeting: "growth",
  // Not on the pricing page; on Growth since it shipped.
  catalogSharing: "growth",
};

export const FEATURE_LABEL: Record<PlanFeature, string> = {
  draftWithClaude: "Draft with Claude",
  netTerms: "Net terms and credit",
  deposits: "Deposits and pay-by-link",
  makeAnOffer: "Make an Offer",
  offerAutomation: "Automatic offer answers",
  fullAnalytics: "Full quote analytics",
  dealAnalytics: "Deal-level analytics",
  salesReps: "The sales-rep portal",
  accountingSync: "QuickBooks and Xero sync",
  whiteLabel: "White-label",
  agency: "Agency mode",
  catalogSharing: "Catalog sharing",
  priceRules: "Price rules",
  priceRuleTargeting: "Targeting by tag, product or collection",
};

/** The tier a shop gets, from its stored plan (grandfathering honoured). */
export function shopPlanHandle(shop: { plan?: string | null; legacyPlan?: boolean | null } | null | undefined): PlanHandle {
  return effectivePlanHandle(shop?.plan ?? null, shop?.legacyPlan ?? false);
}

export function minimumPlan(feature: PlanFeature): PlanHandle {
  return FEATURE_PLAN[feature];
}

/** Display name of the plan a feature needs, e.g. "Scale". */
export function minimumPlanName(feature: PlanFeature): string {
  return PLAN_DISPLAY_NAME[FEATURE_PLAN[feature]];
}

export function featureAvailable(feature: PlanFeature, current: PlanHandle): boolean {
  return meetsPlan(current, FEATURE_PLAN[feature]);
}

export type FeatureGate =
  | { available: true }
  | { available: false; needs: PlanHandle; needsName: string; message: string };

export function featureGate(feature: PlanFeature, current: PlanHandle): FeatureGate {
  if (featureAvailable(feature, current)) return { available: true };
  return {
    available: false,
    needs: FEATURE_PLAN[feature],
    needsName: minimumPlanName(feature),
    message: lockedMessage(feature),
  };
}

/** One sentence for a locked feature: "The sales-rep portal needs the Scale plan." */
export function lockedMessage(feature: PlanFeature): string {
  return `${FEATURE_LABEL[feature]} needs the ${minimumPlanName(feature)} plan.`;
}
