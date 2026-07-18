import type { ActionFunctionArgs } from "@remix-run/node";
import { verifyWebhook } from "../lib/hmac.server";
import { collectCustomerData } from "../services/gdpr.server";

// GDPR customers/data_request. HMAC-verify, then acknowledge. We assemble what
// we hold on the customer so the merchant can fulfil the request.
export const action = async ({ request }: ActionFunctionArgs) => {
  const verification = await verifyWebhook(
    request,
    process.env.SHOPIFY_API_SECRET || "",
  );
  if (!verification.ok) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(verification.rawBody) as {
    shop_domain?: string;
    customer?: { email?: string };
  };
  const shopDomain = payload.shop_domain ?? verification.shopDomain ?? "";
  await collectCustomerData(shopDomain, { email: payload.customer?.email });

  return new Response(null, { status: 200 });
};
