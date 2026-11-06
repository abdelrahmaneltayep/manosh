import { BillingInterval } from "@shopify/shopify-app-remix/server";
import { redirect } from "@remix-run/node";
import type { EventType, Plan } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import {
  STARTER_PLAN,
  GROWTH_PLAN,
  TRIAL_DAYS,
  PLAN_PRICING,
  featureAccess,
  type PlanName,
  type BillingStatus,
} from "../lib/billing";
import {
  PLAN_PRICING_V3,
  resolveGrandfather,
  getPlanCapabilities,
  type PlanCapabilities,
} from "../lib/billing-v3";

/**
 * Billing (S3 skeleton → S17 complete). The plan constants + pure gating live
 * in app/lib/billing.ts (client-safe); this module holds the server-only parts:
 * the shopifyApp billing config, reading the current plan (`requireBilling`),
 * enforcing it (`requirePlan`), and reconciling Shopify's state onto the Shop
 * row — emitting funnel events on plan changes. See /docs/prd.md §3.7.
 */

// Re-export the client-safe pieces so existing server-side importers and tests
// can keep importing them from billing.server.
export {
  STARTER_PLAN,
  GROWTH_PLAN,
  TRIAL_DAYS,
  PLAN_PRICING,
  PLAN_RANK,
  planMeets,
  featureAccess,
  GROWTH_FEATURES,
} from "../lib/billing";
export type {
  PlanName,
  BillingStatus,
  AccessReason,
  FeatureAccess,
  GrowthFeature,
} from "../lib/billing";
import { upgradeUrl } from "../lib/upgrade";

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

// --- Pricing v3 (PR-1) -------------------------------------------------------
// Additive + flag-gated. When MANNON_FF_PLAN_V3 is off, only the legacy config
// above is exposed and everything behaves as before. When on, the v3 ladder is
// ADDED (distinct lowercase names) — legacy "Starter"/"Growth" entries stay so
// grandfathered subscriptions remain chargeable and are never re-priced.

export const PLAN_V3_ENABLED = (): boolean => process.env.MANNON_FF_PLAN_V3 === "true";

const ANNUAL: BillingInterval.Annual = BillingInterval.Annual;
const USD = "USD" as const;

/** Paid v3 plans as Shopify billing entries: a monthly + an annual line per tier.
 *  Free is the absence of a paid subscription, so it has no billing entry. */
const BILLING_CONFIG_V3 = {
  starter: { trialDays: PLAN_PRICING_V3.starter.trialDays, lineItems: [{ amount: PLAN_PRICING_V3.starter.monthlyCents / 100, currencyCode: USD, interval: EVERY_30_DAYS }] },
  "starter-annual": { trialDays: PLAN_PRICING_V3.starter.trialDays, lineItems: [{ amount: (PLAN_PRICING_V3.starter.annualCents ?? 0) / 100, currencyCode: USD, interval: ANNUAL }] },
  growth: { trialDays: PLAN_PRICING_V3.growth.trialDays, lineItems: [{ amount: PLAN_PRICING_V3.growth.monthlyCents / 100, currencyCode: USD, interval: EVERY_30_DAYS }] },
  "growth-annual": { trialDays: PLAN_PRICING_V3.growth.trialDays, lineItems: [{ amount: (PLAN_PRICING_V3.growth.annualCents ?? 0) / 100, currencyCode: USD, interval: ANNUAL }] },
  scale: { trialDays: PLAN_PRICING_V3.scale.trialDays, lineItems: [{ amount: PLAN_PRICING_V3.scale.monthlyCents / 100, currencyCode: USD, interval: EVERY_30_DAYS }] },
  "scale-annual": { trialDays: PLAN_PRICING_V3.scale.trialDays, lineItems: [{ amount: (PLAN_PRICING_V3.scale.annualCents ?? 0) / 100, currencyCode: USD, interval: ANNUAL }] },
};

/** The billing config passed to shopifyApp — legacy always, plus v3 when flagged. */
export const ACTIVE_BILLING_CONFIG = PLAN_V3_ENABLED()
  ? { ...BILLING_CONFIG, ...BILLING_CONFIG_V3 }
  : BILLING_CONFIG;

/**
 * Map a Shopify App Pricing (managed) subscription name to the Prisma plan.
 * Plans live in the Partner Dashboard; their handles are `free/starter/growth/
 * scale`. Matching is case-insensitive so a display-case name ("Starter") maps
 * to the same tier — there is no legacy grandfathering (the app has no pre-v3
 * paying merchants). Pure.
 */
export function resolveV3PlanFromName(
  name: string | null,
): { plan: Plan; legacyPlan: boolean; legacyPriceCents: number | null } {
  // Shopify reports the App Pricing plan's display name (e.g. "Mannon Growth",
  // "Growth (annual)"), not its handle, so match on the tier word anywhere in
  // the name. Tiers are checked highest first so "scale" never reads as "free".
  const words = new Set((name ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean));
  const none = { legacyPlan: false, legacyPriceCents: null };
  if (words.has("scale")) return { plan: "SCALE", ...none };
  if (words.has("growth")) return { plan: "GROWTH", ...none };
  if (words.has("starter")) return { plan: "STARTER", ...none };
  if (words.has("free")) return { plan: "FREE", ...none };
  return { plan: "TRIAL", ...none };
}

/**
 * The Shopify-hosted App Pricing plan-selection page for a shop. Under managed
 * pricing the app never creates charges — it sends the merchant here (top-level)
 * and Shopify handles the subscription, trial, proration and cancellation.
 *
 * The URL needs the app's HANDLE (the Partner Dashboard slug), which is not in
 * shopify.app.toml. Guessing it is exactly what App Store review 1.2.2 caught:
 * a wrong handle lands on Shopify's "There's no page at this address". So the
 * handle is resolved from the Admin API (`currentAppInstallation.app.handle`)
 * via `managedPricingUrlFor`; `SHOPIFY_APP_HANDLE` and the "mannon" default are
 * only the fallback when the API can't be reached. Pure given a handle.
 */
export function managedPricingUrl(shopDomain: string, handle: string = fallbackAppHandle()): string {
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${store}/charges/${handle}/pricing_plans`;
}

function fallbackAppHandle(): string {
  return process.env.SHOPIFY_APP_HANDLE || "mannon";
}

/** Minimal Admin GraphQL client shape (what `authenticate.admin` returns as `admin`). */
export interface AppHandleAdmin {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

const appHandleCache = new Map<string, string>();

/**
 * The app's handle as Shopify knows it for this installation. Cached per shop
 * for the process lifetime (a handle never changes for a released app). Falls
 * back to the env/default handle when the API fails, so the plan page still
 * opens rather than the action erroring.
 */
export async function resolveAppHandle(admin: AppHandleAdmin, shopDomain: string): Promise<string> {
  const cached = appHandleCache.get(shopDomain);
  if (cached) return cached;
  try {
    const res = await admin.graphql(
      `#graphql
      query MannonAppHandle { currentAppInstallation { app { handle } } }`,
    );
    const body = (await res.json()) as { data?: { currentAppInstallation?: { app?: { handle?: string | null } | null } | null } };
    const handle = body?.data?.currentAppInstallation?.app?.handle?.trim();
    if (handle) {
      appHandleCache.set(shopDomain, handle);
      return handle;
    }
  } catch (error) {
    captureException(error);
  }
  return fallbackAppHandle();
}

/** `managedPricingUrl` with the handle resolved live. Use this from routes. */
export async function managedPricingUrlFor(admin: AppHandleAdmin, shopDomain: string): Promise<string> {
  return managedPricingUrl(shopDomain, await resolveAppHandle(admin, shopDomain));
}

/** Test seam: forget cached handles. */
export function clearAppHandleCache(): void {
  appHandleCache.clear();
}

interface SubscriptionLike {
  id?: string;
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
  // Shopify reports the plan's display name ("Mannon Growth", "Scale (annual)"),
  // so read the tier word the same way the stored plan does. The gating view has
  // two paid levels: Scale includes everything Growth has; Free is unpaid.
  const tier = resolveV3PlanFromName(name).plan;
  const plan: PlanName | null =
    tier === "SCALE" || tier === "GROWTH" ? GROWTH_PLAN : tier === "STARTER" ? STARTER_PLAN : null;

  return {
    plan,
    hasActivePayment,
    onTrial: !hasActivePayment,
    activeSubscriptionName: name,
    activeSubscriptionId: active?.id ?? null,
  };
}

/** The subset of the authenticate.admin billing context that we depend on.
 *  Under managed pricing we pass no `plans` filter — we count any active
 *  subscription and map it to a tier by name. */
export interface BillingLike {
  check: (options: {
    isTest: boolean;
  }) => Promise<{ hasActivePayment: boolean; appSubscriptions: SubscriptionLike[] }>;
}

/**
 * Report the merchant's current plan (reads only — never redirects). Use
 * `requirePlan` when you need to enforce a plan and bounce to the billing page.
 *
 * Usage in a route:
 *   const { billing } = await authenticate.admin(request);
 *   const status = await requireBilling(billing);
 */
/** Safe fallback when the billing API can't be reached / read. Treated as "no
 *  active payment" so the page still renders (with its upgrade prompts) instead
 *  of crashing. Never used to GRANT a paid feature — only to read/display. */
const UNKNOWN_BILLING_STATUS: BillingStatus = {
  plan: null,
  hasActivePayment: false,
  onTrial: true,
  activeSubscriptionName: null,
  activeSubscriptionId: null,
};

export async function requireBilling(
  billing: BillingLike,
  options: { isTest?: boolean } = {},
): Promise<BillingStatus> {
  const isTest = options.isTest ?? process.env.NODE_ENV !== "production";
  try {
    // Managed pricing: no plans filter — count ANY active app subscription and
    // map it to a tier by name (reconcileShopPlanV3 → resolveV3PlanFromName).
    // For a read, `isTest` only decides whether TEST subscriptions count
    // (shopify-api: `isTest || !subscription.test`); it never hides live ones.
    // Shopify bills development stores (including App Store review stores)
    // with test subscriptions under managed pricing, so a read must include
    // them, or a plan chosen there never takes effect (and reconcile would
    // record the paid shop as CANCELLED). Shopify decides what is a test charge.
    const { hasActivePayment, appSubscriptions } = await billing.check({ isTest: true });
    return resolveActivePlan(hasActivePayment, appSubscriptions);
  } catch (error) {
    // A billing.check() failure (API error, an unrecognized plan handle in the
    // Partner Dashboard, a transient 5xx) must NEVER crash the page into App
    // Bridge's "Something went wrong" — that's an App Store rejection (2.1.1) and
    // it took down every billing-reading tab. Degrade to "no active payment" so
    // the screen still renders; report for diagnosis. Enforcement paths
    // (requirePlan) keep their own stricter handling.
    console.error(`[requireBilling] billing.check failed (isTest=${isTest}):`, error);
    captureException(error);
    return { ...UNKNOWN_BILLING_STATUS, unverified: true };
  }
}

/**
 * Enforce that the merchant's plan meets `required`. Returns the status when
 * allowed; otherwise throws a redirect to the settings billing section (with an
 * `?upgrade=` hint so the page can explain why). Use this to guard Growth-only
 * routes:
 *   const status = await requirePlan(billing, GROWTH_PLAN);
 */
export async function requirePlan(
  billing: BillingLike,
  required: PlanName,
  options: { isTest?: boolean; redirectTo?: string } = {},
): Promise<BillingStatus> {
  const status = await requireBilling(billing, { isTest: options.isTest });
  if (!featureAccess(status, required).allowed) {
    throw redirect(options.redirectTo ?? upgradeUrl(required));
  }
  return status;
}

// --- plan persistence + funnel events ---------------------------------------

/** The Prisma Plan enum value implied by a live billing status. */
export function planEnumFor(status: BillingStatus): Extract<Plan, "TRIAL" | "STARTER" | "GROWTH"> {
  if (status.plan === GROWTH_PLAN) return "GROWTH";
  if (status.plan === STARTER_PLAN) return "STARTER";
  return "TRIAL";
}

const PLAN_ENUM_RANK: Record<Plan, number> = {
  TRIAL: 0,
  CANCELLED: 0,
  FREE: 0,
  STARTER: 1,
  GROWTH: 2,
  SCALE: 3,
};

const PAID_PLANS: Plan[] = ["STARTER", "GROWTH", "SCALE"];

/** Which funnel event (if any) a plan transition should record. Pure. */
export function planChangeEvent(from: Plan, to: Plan): EventType | null {
  if (to === "CANCELLED") {
    return PAID_PLANS.includes(from) ? "PLAN_CANCELLED" : null;
  }
  if (PLAN_ENUM_RANK[to] > PLAN_ENUM_RANK[from]) {
    // First move out of the default TRIAL into a paid plan = the trial starting;
    // any later rank increase (Starter → Growth, or resubscribe) is an upgrade.
    return from === "TRIAL" ? "TRIAL_STARTED" : "PLAN_UPGRADED";
  }
  return null; // downgrades (Growth → Starter) have no dedicated funnel event
}

/**
 * Reconcile Shopify's billing state onto the Shop row (Shopify is the source of
 * truth). Persists the plan and appends a funnel event on any change. Losing an
 * active paid plan (Shopify shows no active payment while we had one recorded)
 * is treated as a cancellation. Idempotent: no-ops when nothing changed.
 */
export async function reconcileShopPlan(
  shopDomain: string,
  status: BillingStatus,
): Promise<Plan> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, plan: true, legacyPlan: true, legacyPriceCents: true },
  });
  if (!shop) return planEnumFor(status);
  // Shopify's billing couldn't be read: keep what we have. Never downgrade or
  // cancel a plan on a failed read.
  if (status.unverified) return shop.plan;

  // Pricing v3: resolve from the raw subscription name (v3 handles + legacy
  // names), persisting grandfathering so nobody's price is ever silently raised.
  if (PLAN_V3_ENABLED()) {
    return reconcileShopPlanV3(shop, status);
  }

  let next: Plan;
  if (status.plan) {
    next = planEnumFor(status);
  } else if (shop.plan === "STARTER" || shop.plan === "GROWTH") {
    next = "CANCELLED"; // had a paid plan, Shopify now reports none → cancelled
  } else {
    next = shop.plan; // TRIAL or CANCELLED — nothing new to record
  }

  if (next === shop.plan) return shop.plan;

  await prisma.shop.update({ where: { id: shop.id }, data: { plan: next } });

  const eventType = planChangeEvent(shop.plan, next);
  if (eventType) {
    await appendEvent({
      shopId: shop.id,
      type: eventType,
      entityType: "Shop",
      entityId: shop.id,
      payload: { from: shop.plan, to: next },
    });
  }
  return next;
}

/**
 * Pricing-v3 reconcile. Resolves the Prisma plan + grandfathering from the raw
 * active subscription name and persists `legacyPlan`/`legacyPriceCents` so a
 * grandfathered shop's price is never silently raised. Idempotent.
 */
async function reconcileShopPlanV3(
  shop: { id: string; plan: Plan; legacyPlan: boolean; legacyPriceCents: number | null },
  status: BillingStatus,
): Promise<Plan> {
  let next: Plan;
  let legacyPlan = shop.legacyPlan;
  let legacyPriceCents = shop.legacyPriceCents;

  if (status.activeSubscriptionName) {
    const resolved = resolveV3PlanFromName(status.activeSubscriptionName);
    next = resolved.plan;
    legacyPlan = resolved.legacyPlan;
    legacyPriceCents = resolved.legacyPriceCents;
  } else if (PAID_PLANS.includes(shop.plan)) {
    next = "CANCELLED"; // had a paid plan, Shopify now reports none
    legacyPlan = false;
    legacyPriceCents = null;
  } else {
    next = shop.plan; // TRIAL / FREE / CANCELLED — nothing new
  }

  const unchanged = next === shop.plan && legacyPlan === shop.legacyPlan && legacyPriceCents === shop.legacyPriceCents;
  if (unchanged) return shop.plan;

  await prisma.shop.update({ where: { id: shop.id }, data: { plan: next, legacyPlan, legacyPriceCents } });

  const eventType = planChangeEvent(shop.plan, next);
  if (eventType) {
    await appendEvent({
      shopId: shop.id,
      type: eventType,
      entityType: "Shop",
      entityId: shop.id,
      payload: { from: shop.plan, to: next, legacy: legacyPlan },
    });
  }
  return next;
}

/**
 * The v3 capability object for a shop (§1.3), honoring grandfathering. Reads the
 * persisted plan + legacy flag. Used by route gates and the plan UI. Falls back
 * to Free capabilities for an unknown shop.
 */
export async function getShopCapabilities(shopDomain: string): Promise<PlanCapabilities> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { plan: true, legacyPlan: true },
  });
  return getPlanCapabilities(shop?.plan ?? null, shop?.legacyPlan ?? false);
}
