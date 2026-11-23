import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { expireQuotesDue } from "../services/quote.server";

/**
 * F1 — quote expiry sweep. Hit by an external scheduler (see /docs/cron.md),
 * hourly is plenty:
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/expire-quotes \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Flips every open quote (SUBMITTED / COUNTERED / ACCEPTED) past its
 * `expiresAt` to EXPIRED, across all shops, one QUOTE_EXPIRED event each. The
 * inbox only *displays* overdue quotes as expired; this is the write that makes
 * it true for the dashboard, analytics and the buyer portal.
 *
 * Not a Shopify webhook, so no HMAC — guarded by CRON_SECRET like the other
 * /internal/cron/* routes. Deliberately NOT feature-flagged: expiry is part of
 * the core quote status machine, not an add-on. Idempotent — a second run finds
 * nothing left to expire.
 */
async function run(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (request.headers.get("x-cron-secret") !== secret) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const expired = await expireQuotesDue({ now });

  return json({ ok: true, ranAt: now.toISOString(), expired });
}

// Accept POST (preferred) and GET (some schedulers only do GET) — both require
// the secret header.
export const action = ({ request }: ActionFunctionArgs) => run(request);
export const loader = ({ request }: LoaderFunctionArgs) => run(request);
