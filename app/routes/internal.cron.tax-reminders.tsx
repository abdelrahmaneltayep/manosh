import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { runCertExpiryRemindersForShop } from "../services/tax.server";

/**
 * F14 — tax-certificate expiry reminders. Hit daily:
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/tax-reminders \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Per shop: email buyers whose verified exemption certificate expires within 30
 * days (idempotent per window). Not a Shopify webhook, so no HMAC — guarded by
 * CRON_SECRET. Feature-flagged with MANNON_FF_TAX_VAT.
 */
async function run(request: Request): Promise<Response> {
  if (process.env.MANNON_FF_TAX_VAT !== "true") {
    return Response.json({ ok: true, skipped: "feature-off" });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const shops = await prisma.shop.findMany({ select: { shopifyDomain: true } });
  const results: Array<{ shop: string; sent: number }> = [];
  for (const shop of shops) {
    const sent = await runCertExpiryRemindersForShop(shop.shopifyDomain, now);
    results.push({ shop: shop.shopifyDomain, sent });
  }
  return Response.json({ ok: true, ranAt: now.toISOString(), results });
}

export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
