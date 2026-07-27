import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { refreshOverdue } from "../services/invoice.server";
import { runRemindersForShop } from "../services/reminders.server";

/**
 * F2 — reminder scheduler entrypoint. Hit by an external scheduler (Fly Machines
 * cron, GitHub Action, or the claude-code-remote Routines) once a day:
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/reminders \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Protected by a shared secret (CRON_SECRET) — NOT a Shopify webhook, so no HMAC.
 * Runs per shop: flips overdue invoices, then sends any due T-3 / due / +7
 * reminders. Auto-reminders are Growth-only, so Starter shops are skipped.
 * Feature-flagged with MANNON_FF_CREDIT.
 */

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function run(request: Request): Promise<Response> {
  if (process.env.MANNON_FF_CREDIT !== "true") {
    return Response.json({ ok: true, skipped: "feature-off" });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return unauthorized();

  const now = new Date();
  const shops = await prisma.shop.findMany({ select: { shopifyDomain: true, plan: true } });

  const results: Array<{ shop: string; sent?: number; skipped?: string }> = [];
  for (const shop of shops) {
    // Auto-reminders are Growth-only. Starter still gets overdue flips (cheap,
    // used by the invoices view) but no emails.
    await refreshOverdue((await shopIdFor(shop.shopifyDomain)) ?? "", now);
    if (shop.plan !== "GROWTH") {
      results.push({ shop: shop.shopifyDomain, skipped: "not-growth" });
      continue;
    }
    const res = await runRemindersForShop(shop.shopifyDomain, now);
    results.push({ shop: shop.shopifyDomain, sent: res.sent });
  }

  return Response.json({ ok: true, ranAt: now.toISOString(), results });
}

async function shopIdFor(domain: string): Promise<string | null> {
  const s = await prisma.shop.findUnique({ where: { shopifyDomain: domain }, select: { id: true } });
  return s?.id ?? null;
}

// Accept POST (preferred) and GET (some schedulers only do GET) — both require
// the secret header.
export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
