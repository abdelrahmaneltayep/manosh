import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { PWA_ENABLED, runReorderPushForShop, sendInstallNudges } from "../services/pwa.server";

/**
 * F18 — buyer-PWA reorder nudges. Hit on a schedule (e.g. weekly):
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/reorder-push \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Per shop: send opt-in web-push "time to reorder?" nudges to Growth buyers who
 * subscribed (delivery no-ops until VAPID is wired), and email an "install the
 * app" nudge to active buyers without a push subscription yet. Not a Shopify
 * webhook, so no HMAC — guarded by CRON_SECRET. Behind MANNON_FF_BUYER_PWA.
 */
async function run(request: Request): Promise<Response> {
  if (!PWA_ENABLED()) return Response.json({ ok: true, skipped: "feature-off" });
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const shops = await prisma.shop.findMany({ select: { shopifyDomain: true } });

  const results: Array<{ shop: string; pushed: number; nudged: number }> = [];
  for (const shop of shops) {
    const pushed = await runReorderPushForShop(shop.shopifyDomain, baseUrl);
    const nudged = await sendInstallNudges(shop.shopifyDomain, baseUrl);
    results.push({ shop: shop.shopifyDomain, pushed, nudged });
  }

  return Response.json({ ok: true, results });
}

export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
