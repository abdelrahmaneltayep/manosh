import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCertificate } from "../services/tax.server";

const ENABLED = () => process.env.MANNON_FF_TAX_VAT === "true";

/**
 * F14 — private certificate download. Authenticated admin only + ownership
 * checked in the service. Certificates are NEVER served from a public URL; they
 * live in private storage and are streamed here behind the Shopify admin session.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const cert = await getCertificate(session.shop, params.companyId!);
  if (!cert) throw new Response("Not found", { status: 404 });
  return new Response(cert.data as BodyInit, {
    headers: {
      "Content-Type": cert.type,
      "Content-Disposition": `attachment; filename="${cert.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
