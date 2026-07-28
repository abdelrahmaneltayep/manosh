import type { ActionFunctionArgs } from "@remix-run/node";
import { getBuyerId } from "../services/buyer-session.server";
import { PWA_ENABLED, logPwaInstalled } from "../services/pwa.server";

/**
 * F18 — records that a buyer installed the PWA (pwa_installed event). Called by
 * the portal shell's `appinstalled` listener. Best-effort: always 204 so a
 * failure never surfaces to the buyer. GET is not supported.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!PWA_ENABLED()) throw new Response("Not found", { status: 404 });
  const buyerId = await getBuyerId(request);
  if (buyerId) {
    try {
      await logPwaInstalled(buyerId);
    } catch {
      // Swallow — install tracking must never break the install.
    }
  }
  return new Response(null, { status: 204 });
};
