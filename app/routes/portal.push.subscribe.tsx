import type { ActionFunctionArgs } from "@remix-run/node";
import { getBuyerId } from "../services/buyer-session.server";
import {
  PWA_ENABLED,
  savePushSubscription,
  deletePushSubscription,
} from "../services/pwa.server";

/**
 * F18 — opt-in Web Push subscribe/unsubscribe. The buyer's browser posts its
 * PushSubscription JSON here only after they grant permission (strictly opt-in).
 * `unsubscribe` removes it. Returns JSON so the client can update its UI.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!PWA_ENABLED()) throw new Response("Not found", { status: 404 });
  const buyerId = await getBuyerId(request);
  if (!buyerId) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body: { endpoint?: unknown; keys?: unknown; unsubscribe?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return Response.json({ ok: false, error: "Missing endpoint." }, { status: 400 });

  if (body.unsubscribe) {
    await deletePushSubscription(endpoint);
    return Response.json({ ok: true });
  }

  await savePushSubscription(buyerId, endpoint, body.keys);
  return Response.json({ ok: true });
};
