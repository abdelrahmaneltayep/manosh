import type { LoaderFunctionArgs } from "@remix-run/node";
import { getQuoteCaptureConfig } from "../services/quote-form.server";

/**
 * F24.3 — public on/off for the Add-to-Quote drawer + cart→quote theme blocks.
 * `?shop=` → `{ enabled }` (feature flag on AND a paid plan). Public + CORS, no
 * secrets. Short cache.
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
  if (!shop) return Response.json({ enabled: false }, { headers: CORS });
  return Response.json(await getQuoteCaptureConfig(shop), { headers: CORS });
};
