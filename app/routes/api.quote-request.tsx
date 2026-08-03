import type { ActionFunctionArgs } from "@remix-run/node";
import { createQuoteRequest } from "../services/quote-widget.server";

/**
 * F17 — public submission endpoint for the storefront "Request a Quote" widget.
 * CORS-enabled (the storefront is a different origin). Anti-spam (honeypot +
 * rate limit + too-fast) is enforced in the service; spam gets a generic OK so
 * bots learn nothing. All input is validated + escaped server-side.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed" }, { status: 405, headers: CORS });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400, headers: CORS });
  }

  const shop = String(body.shop ?? "");
  if (!shop) return Response.json({ ok: false, error: "Missing shop." }, { status: 400, headers: CORS });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  const result = await createQuoteRequest(
    shop,
    {
      email: body.email,
      companyName: body.companyName,
      note: body.note,
      lines: body.lines,
      honeypot: body.company_url_confirm,
      elapsedMs: typeof body.elapsedMs === "number" ? body.elapsedMs : undefined,
      customFields: (body.customFields as Record<string, unknown>) ?? undefined,
      source: (body.source as "PDP" | "CART" | "WIDGET") ?? "PDP",
      formId: typeof body.formId === "string" ? body.formId : null,
      channel: body.channel === "CAPTURE" ? "CAPTURE" : "WIDGET",
    },
    { rateKey: `${shop}:${ip}`, baseUrl },
  );

  // A silent (spam/rate-limited) result looks identical to success to the client.
  if (result.ok) return Response.json({ ok: true }, { headers: CORS });
  return Response.json({ ok: false, error: result.error }, { status: 400, headers: CORS });
};

export const loader = () => new Response("Method not allowed", { status: 405 });
