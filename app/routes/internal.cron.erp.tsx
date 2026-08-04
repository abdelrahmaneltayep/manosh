import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { runExportForShop, sendFailureDigest, makeConnector } from "../services/erp.server";

/**
 * F15 — ERP outbound export worker. Hit on a schedule (every ~15 min):
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/erp \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Per shop: process due PENDING order exports (capped backoff) then send at most
 * one failure digest. Not a Shopify webhook, so no HMAC — guarded by CRON_SECRET.
 * Feature-flagged with MANNON_FF_ERP_SYNC.
 */
async function run(request: Request): Promise<Response> {
  if (process.env.MANNON_FF_ERP_SYNC !== "true") return json({ ok: true, skipped: "feature-off" });
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const shops = await prisma.shop.findMany({ select: { shopifyDomain: true } });
  const results: Array<{ shop: string; synced: number; failed: number; digested: boolean }> = [];
  for (const shop of shops) {
    const summary = await runExportForShop(shop.shopifyDomain, makeConnector, now);
    const digested = await sendFailureDigest(shop.shopifyDomain);
    results.push({ shop: shop.shopifyDomain, synced: summary.synced, failed: summary.failed, digested });
  }
  return json({ ok: true, ranAt: now.toISOString(), results });
}

export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
