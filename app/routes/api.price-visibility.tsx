import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { evaluatePriceVisibility } from "../services/price-visibility.server";

/**
 * F24.2 — public price/ATC visibility decision for the storefront. The theme app
 * extension passes the visitor context and gets back ONLY the hide flags + CTA
 * label. It never returns (and never receives) a price, so a hidden price can't
 * leak through this endpoint (§5.2). Public + CORS; short cache since the answer
 * depends on the (client-supplied) context.
 *
 * Query: ?shop= &loggedIn=0|1 &tags=a,b &productId=gid &collectionIds=gid,gid
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "private, max-age=30",
};

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return json({ hidePrice: false, hideAtc: false, ctaLabel: null }, { headers: CORS });

  const decision = await evaluatePriceVisibility(shop, {
    loggedIn: url.searchParams.get("loggedIn") === "1" || url.searchParams.get("loggedIn") === "true",
    customerTags: list(url.searchParams.get("tags")),
    productId: url.searchParams.get("productId"),
    collectionIds: list(url.searchParams.get("collectionIds")),
  });

  // Decision is { hidePrice, hideAtc, ctaLabel } — no price, by construction.
  return json(decision, { headers: CORS });
};
