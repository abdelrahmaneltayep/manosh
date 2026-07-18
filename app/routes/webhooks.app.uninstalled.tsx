import type { ActionFunctionArgs } from "@remix-run/node";
import { verifyWebhook } from "../lib/hmac.server";
import { cleanupUninstall } from "../services/gdpr.server";

// app/uninstalled. HMAC-verify, then remove the shop's sessions. Full shop data
// erasure happens ~48h later via shop/redact (see /docs/compliance.md).
export const action = async ({ request }: ActionFunctionArgs) => {
  const verification = await verifyWebhook(
    request,
    process.env.SHOPIFY_API_SECRET || "",
  );
  if (!verification.ok) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(verification.rawBody || "{}") as {
    myshopify_domain?: string;
    domain?: string;
  };
  const shopDomain =
    verification.shopDomain ?? payload.myshopify_domain ?? payload.domain ?? "";
  if (shopDomain) {
    await cleanupUninstall(shopDomain);
  }

  return new Response(null, { status: 200 });
};
