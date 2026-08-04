import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { applyStockUpdate, getInboundSecret } from "../services/erp.server";

/**
 * F15 — inbound ERP stock webhook. The ERP POSTs stock updates here:
 *
 *   curl -X POST https://manosh.fly.dev/internal/erp/stock \
 *     -H "x-shop-domain: acme.myshopify.com" \
 *     -H "x-erp-secret: <the connection secret>" \
 *     -H "content-type: application/json" \
 *     -d '[{"variantId":"gid://shopify/ProductVariant/1","qty":0}]'
 *
 * Not a Shopify webhook — authenticated by the per-connection secret (the same
 * encrypted credential the connection stores). Body may be a JSON array or a
 * `variant_id,qty` CSV. Feature-flagged with MANNON_FF_ERP_SYNC.
 */
export const action = async ({ request }: ActionFunctionArgs): Promise<Response> => {
  if (process.env.MANNON_FF_ERP_SYNC !== "true") return json({ ok: true, skipped: "feature-off" });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const shopDomain = request.headers.get("x-shop-domain");
  const provided = request.headers.get("x-erp-secret");
  if (!shopDomain || !provided) return new Response("Missing shop/secret", { status: 400 });

  const expected = await getInboundSecret(shopDomain);
  if (!expected || provided !== expected) return new Response("Unauthorized", { status: 401 });

  const contentType = request.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json") ? await request.json() : await request.text();

  const { applied, errors } = await applyStockUpdate(shopDomain, payload);
  return json({ ok: true, applied, skipped: errors.length });
};

export const loader = () => new Response("Method not allowed", { status: 405 });
