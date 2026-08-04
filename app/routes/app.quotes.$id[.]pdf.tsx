import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { featureAccess, STARTER_PLAN } from "../lib/billing";
import { getCatalog } from "../services/catalog.server";
import { renderQuotePdf } from "../services/quote-pdf.server";
import { appendEvent } from "../services/events.server";
import { QUOTE_OPS_ENABLED } from "../lib/quote-ops";

const IS_TEST = process.env.NODE_ENV !== "production";

/**
 * F25.1 — download the branded quote PDF. Server-side render (no client dep, no
 * LCP impact). Gated to a paid plan (Starter+); white-label footer removal follows
 * the plan inside the renderer. The filename is generic ("quote.pdf") — nothing
 * sensitive in it.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!QUOTE_OPS_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!featureAccess(status, STARTER_PLAN).allowed) {
    throw new Response("Downloading the quote PDF needs a paid plan.", { status: 402 });
  }
  const catalog = await getCatalog(session.shop);
  const currencyCode = catalog[0]?.currencyCode ?? "USD";
  const pdf = await renderQuotePdf(session.shop, params.id!, { currencyCode, plan: status.plan });
  if (!pdf) throw new Response("Quote not found", { status: 404 });

  await appendEvent({ shopId: pdf.shopId, type: "QUOTE_PDF_GENERATED", entityType: "Quote", entityId: params.id!, payload: { via: "download" } });

  // Uint8Array is a valid Response body at runtime; cast past the DOM lib's
  // ArrayBufferLike/ArrayBuffer type mismatch.
  return new Response(pdf.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
