import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { rollupAllShops, getAnalytics } from "../services/quote-analytics.server";
import { resolveTemplate, renderTemplate, sendEmail } from "../services/mailer.server";

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
    return Response.json({ ok: true, skipped: "feature-off" });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const rolled = await rollupAllShops(now);

  let digests = 0;
  if (now.getUTCDay() === 1) {
    // Monday — weekly digest for opted-in Growth shops.
    const shops = await prisma.shop.findMany({
      where: { plan: "GROWTH", weeklyDigest: true },
      select: { shopifyDomain: true, emailTemplates: true },
    });
    const to = process.env.MANNON_MAIL_FROM; // best-effort recipient until owner email is wired
    for (const shop of shops) {
      const view = await getAnalytics(shop.shopifyDomain, 7, now);
      if (!view || !to) continue;
      const tpl = resolveTemplate("weekly_digest", shop.emailTemplates);
      const { subject, body } = renderTemplate(tpl, {
        shopName: shop.shopifyDomain,
        quotes: String(view.count),
        winRate: view.kpis.winRate == null ? "—" : `${Math.round(view.kpis.winRate * 100)}%`,
        pipeline: `${view.currency} ${view.kpis.openPipeline.toFixed(2)}`,
      });
      await sendEmail({ to, subject, html: body, text: body });
      digests++;
    }
  }

  return Response.json({ ok: true, ranAt: now.toISOString(), rolled, digests });
}

export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
