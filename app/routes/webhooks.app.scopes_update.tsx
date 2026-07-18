import type { ActionFunctionArgs } from "@remix-run/node";
import { verifyWebhook } from "../lib/hmac.server";
import db from "../db.server";

// app/scopes_update. HMAC-verify, then record the new granted scopes on the
// shop's sessions.
export const action = async ({ request }: ActionFunctionArgs) => {
  const verification = await verifyWebhook(
    request,
    process.env.SHOPIFY_API_SECRET || "",
  );
  if (!verification.ok) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(verification.rawBody || "{}") as {
    current?: string[];
  };
  const shopDomain = verification.shopDomain;
  if (shopDomain && Array.isArray(payload.current)) {
    await db.session.updateMany({
      where: { shop: shopDomain },
      data: { scope: payload.current.join(",") },
    });
  }

  return new Response(null, { status: 200 });
};
