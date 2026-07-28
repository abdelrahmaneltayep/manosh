import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { reconcileScheduleForShop, dispatchForShop } from "../services/followups.server";

/**
 * F8 — follow-up scheduler entrypoint. Hit daily (ideally a few times a day so
 * quiet-hours sends land in business hours):
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/followups \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Per shop: reconcile schedules (schedule active quotes, cancel terminal ones),
 * then dispatch due reminders/warnings + run expiries. Not a Shopify webhook, so
 * no HMAC — guarded by CRON_SECRET. Feature-flagged with MANNON_FF_FOLLOWUPS.
 */
async function run(request: Request): Promise<Response> {
  if (process.env.MANNON_FF_FOLLOWUPS !== "true") {
    return Response.json({ ok: true, skipped: "feature-off" });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const shops = await prisma.shop.findMany({ select: { shopifyDomain: true } });

  const results: Array<{ shop: string; sent: number; expired: number }> = [];
  for (const shop of shops) {
    await reconcileScheduleForShop(shop.shopifyDomain);
    const r = await dispatchForShop(shop.shopifyDomain, baseUrl, now);
    results.push({ shop: shop.shopifyDomain, sent: r.sent, expired: r.expired });
  }

  return Response.json({ ok: true, ranAt: now.toISOString(), results });
}

export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
