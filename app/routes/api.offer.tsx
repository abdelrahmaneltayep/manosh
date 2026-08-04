import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { submitPublicOffer, type PublicOfferLine } from "../services/offers.server";

/**
 * F21 (PR-4) — public submission endpoint for the storefront "Make an offer"
 * widget. CORS-enabled (the storefront is a different origin). Anti-spam
 * (honeypot + too-fast + rate limit) is enforced in the service; spam gets a
 * generic OK so bots learn nothing. The margin floor is enforced server-side, so
 * a spoofed list price can never force an unsafe accept.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function toLines(raw: unknown): PublicOfferLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      variantId: String(o.variantId ?? ""),
      title: o.title == null ? undefined : String(o.title),
      sku: o.sku == null ? undefined : String(o.sku),
      quantity: Number(o.quantity ?? 0),
      listPrice: Number(o.listPrice ?? 0),
    };
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405, headers: CORS });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid request." }, { status: 400, headers: CORS });
  }

  const shop = String(body.shop ?? "");
  if (!shop) return json({ ok: false, error: "Missing shop." }, { status: 400, headers: CORS });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";

  const result = await submitPublicOffer(
    shop,
    {
      buyerEmail: String(body.email ?? ""),
      companyId: body.companyId == null ? null : String(body.companyId),
      source: (body.source as "PRODUCT" | "CART" | "ORDER") ?? "PRODUCT",
      lines: toLines(body.lines),
      offeredTotal: Number(body.offeredTotal ?? 0),
      honeypot: typeof body.company_url_confirm === "string" ? body.company_url_confirm : undefined,
      elapsedMs: typeof body.elapsedMs === "number" ? body.elapsedMs : undefined,
    },
    { rateKey: `${shop}:${ip}` },
  );

  if (result.ok) {
    // A silent (spam/rate-limited) drop is indistinguishable from a real submit.
    return json({ ok: true, outcome: result.outcome ?? "pending", counterTotal: result.counterTotal ?? null }, { headers: CORS });
  }
  return json({ ok: false, error: result.error }, { status: 400, headers: CORS });
};

export const loader = () => new Response("Method not allowed", { status: 405 });
