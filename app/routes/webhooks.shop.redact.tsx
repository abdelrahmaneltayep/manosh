import type { ActionFunctionArgs } from "@remix-run/node";
import { verifyWebhook } from "../lib/hmac.server";
import { redactShop } from "../services/gdpr.server";

// GDPR shop/redact. HMAC-verify, then cascade-delete everything under the shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const verification = await verifyWebhook(
    request,
    process.env.SHOPIFY_API_SECRET || "",
  );
  if (!verification.ok) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(verification.rawBody) as { shop_domain?: string };
  const shopDomain = payload.shop_domain ?? verification.shopDomain ?? "";
  await redactShop(shopDomain);

  return new Response(null, { status: 200 });
};
