import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getOfferPublicConfig } from "../services/offers.server";

/**
 * F21 (PR-4) — public config for the Make-an-Offer theme app extension. The
 * storefront block fetches this to decide whether to render, its label, which
 * surfaces are on, and whether answers can be instant (Scale). Public + CORS:
 * no secrets, no hidden-catalog data. `?shop=<domain>`.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return json({ enabled: false }, { headers: CORS });
  const config = await getOfferPublicConfig(shop);
  return json(config, { headers: CORS });
};
