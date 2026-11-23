import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { expireQuotesDue } from "../services/quote.server";

/**
 * F1 — quote expiry sweep. Hit on a schedule (hourly is plenty):
 *
 *   curl -X POST https://manosh.fly.dev/internal/cron/quote-expiry \
 *     -H "x-cron-secret: $CRON_SECRET"
 *
 * Marks every open quote (SUBMITTED / COUNTERED / ACCEPTED) whose `expiresAt` has
 * passed as EXPIRED, across all shops, and appends one QUOTE_EXPIRED event each.
 * Until this runs, an overdue quote is only *shown* as Expired (the inbox derives
 * that from the clock); the stored status, the Home counts and the buyer portal
 * still treat it as open. A quote is also expired when someone opens it, so this
 * sweep is what covers the quotes nobody looks at.
 *
 * Core behaviour on every plan, so there is no feature flag. Not a Shopify
 * webhook, so no HMAC: guarded by CRON_SECRET like the other cron routes.
 * Idempotent: a second run finds nothing to expire. See docs/scheduled-jobs.md.
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
