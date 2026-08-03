import { redirect } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { effectivePlanHandle, meetsPlan, type PlanHandle } from "../lib/billing-v3";

/**
 * Pricing v3 route gate. Enforces that the authenticated shop's effective plan
 * (with grandfathering) meets `minPlan`; otherwise redirects to the in-app
 * upgrade screen. Kept in its own module so it can import `authenticate` from
 * shopify.server without creating a cycle (shopify.server imports the billing
 * config from billing.server, not this file).
 *
 * Gate BOTH the loader/action (here) and the UI (disabled + upgrade-labeled) —
 * per the Global rules, locked features are never clickable-then-error.
 */
export async function requirePlanV3(request: Request, minPlan: PlanHandle): Promise<PlanHandle> {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true },
  });
  const current = effectivePlanHandle(shop?.plan ?? null, shop?.legacyPlan ?? false);
  if (!meetsPlan(current, minPlan)) {
    throw redirect(`/app/settings?upgrade=${minPlan}`);
  }
  return current;
}
