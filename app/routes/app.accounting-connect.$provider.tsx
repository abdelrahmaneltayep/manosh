import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { accountingSyncAllowed } from "../lib/billing";
import { buildAuthorizeUrl, signState, oauthConfig } from "../services/accounting.server";
import type { Provider } from "../lib/accounting";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_ACCOUNTING_SYNC === "true";

/**
 * F10 — OAuth start. Growth-gated. Builds the provider authorize URL with a
 * signed `state` (carries the shop, verified by the public callback) and
 * top-level redirects the browser to the provider. Rendered with target="_top"
 * from the settings page so it breaks out of the embedded iframe.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!accountingSyncAllowed(status.plan)) {
    throw redirect("/app/settings?upgrade=Growth");
  }

  const raw = (params.provider ?? "").toUpperCase();
  if (raw !== "QBO" && raw !== "XERO") throw new Response("Unknown provider", { status: 404 });
  const provider = raw as Provider;

  const cfg = oauthConfig(provider);
  if (!cfg.clientId) {
    // Not configured yet — send the merchant back with a clear hint instead of
    // bouncing them to a broken provider screen.
    throw redirect(`/app/accounting?error=${provider.toLowerCase()}_not_configured`);
  }

  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const state = signState(session.shop, provider);
  throw redirect(buildAuthorizeUrl(provider, baseUrl, state));
};
