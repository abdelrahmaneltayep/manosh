import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { shopNameFor } from "../services/shop-name.server";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { rollupAllShops, getAnalytics } from "../services/quote-analytics.server";
import { resolveTemplate, renderTemplate } from "../services/mailer.server";
import { alertMerchant } from "../services/merchant-alerts.server";

/**
 * F7 — analytics rollup scheduler. Hit daily by an external scheduler:
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/analytics \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Builds yesterday's QuoteMetricDaily for every Growth shop. On Mondays it also
 * sends the opt-in "your week in quotes" digest. Not a Shopify webhook, so no
 * HMAC — guarded by CRON_SECRET. Feature-flagged with MANNON_FF_QUOTE_ANALYTICS.
 */

async function run(request: Request): Promise<Response> {
  if (process.env.MANNON_FF_QUOTE_ANALYTICS !== "true") {
    return json({ ok: true, skipped: "feature-off" });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const rolled = await rollupAllShops(now);

  let digests = 0;
  if (now.getUTCDay() === 1) {
    // Monday — weekly digest for opted-in Growth and Scale shops.
    const shops = await prisma.shop.findMany({
      where: { plan: { in: ["GROWTH", "SCALE"] }, weeklyDigest: true },
      select: { id: true, shopifyDomain: true, emailTemplates: true },
    });
    // Sent to the store's own alert addresses (Settings › Notifications), at
    // most once a week even if the job runs twice on a Monday.
    const weekAgo = new Date(now.getTime() - 6 * 86_400_000);
    for (const shop of shops) {
      const already = await prisma.emailDelivery.count({
        where: { shopId: shop.id, template: "weekly_digest", status: "SENT", createdAt: { gte: weekAgo } },
      });
      if (already) continue;
      const view = await getAnalytics(shop.shopifyDomain, 7, now);
      if (!view) continue;
      const tpl = resolveTemplate("weekly_digest", shop.emailTemplates);
      const { subject, body } = renderTemplate(tpl, {
        shopName: await shopNameFor(shop.shopifyDomain),
        quotes: String(view.count),
        winRate: view.kpis.winRate == null ? "—" : `${Math.round(view.kpis.winRate * 100)}%`,
        pipeline: `${view.currency} ${view.kpis.openPipeline.toFixed(2)}`,
      });
      const results = await alertMerchant(
        shop.shopifyDomain,
        { subject, text: body },
        { template: "weekly_digest", entityType: "Shop", entityId: shop.id },
      );
      if (results.some((r) => r.sent)) digests++;
    }
  }

  return json({ ok: true, ranAt: now.toISOString(), rolled, digests });
}

export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
