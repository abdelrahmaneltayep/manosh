import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { runPaymentRemindersForShop } from "../services/payments.server";

/**
 * F13 — payment-installment reminder scheduler. Hit daily:
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/payment-reminders \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Per shop: flip overdue installments and send due/overdue reminder emails,
 * idempotent per installment+stage (reuses the F8 mailer conventions —
 * unsubscribe + quiet hours). Not a Shopify webhook, so no HMAC — guarded by
 * CRON_SECRET. Feature-flagged with MANNON_FF_FLEX_PAY.
 */
async function run(request: Request): Promise<Response> {
  if (process.env.MANNON_FF_FLEX_PAY !== "true") {
    return Response.json({ ok: true, skipped: "feature-off" });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const shops = await prisma.shop.findMany({ select: { shopifyDomain: true } });

  const results: Array<{ shop: string; due: number; overdue: number }> = [];
  for (const shop of shops) {
    const r = await runPaymentRemindersForShop(shop.shopifyDomain, baseUrl, now);
    results.push({ shop: shop.shopifyDomain, due: r.due, overdue: r.overdue });
  }
  return Response.json({ ok: true, ranAt: now.toISOString(), results });
}

export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
