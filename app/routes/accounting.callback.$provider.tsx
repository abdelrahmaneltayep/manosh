import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  verifyState,
  exchangeCodeForTokens,
  saveConnection,
} from "../services/accounting.server";
import { captureException } from "../lib/sentry.server";
import type { Provider } from "../lib/accounting";

const ENABLED = () => process.env.MANNON_FF_ACCOUNTING_SYNC === "true";

/**
 * F10 — public OAuth callback (no Shopify session here). Trust comes from the
 * signed `state` we minted at connect time, which carries the shop. Exchange the
 * code for tokens, store them encrypted, then bounce back into the embedded app.
 * Never logs tokens.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (!ENABLED()) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId"); // QBO passes the company id here
  const err = url.searchParams.get("error");

  const raw = (params.provider ?? "").toUpperCase();
  if (raw !== "QBO" && raw !== "XERO") throw new Response("Unknown provider", { status: 404 });
  const provider = raw as Provider;

  if (err) throw redirect(`/app/accounting?error=${provider.toLowerCase()}_denied`);
  if (!code || !state) throw new Response("Missing code/state", { status: 400 });

  const verified = verifyState(state);
  if (!verified || verified.provider !== provider) {
    throw new Response("Invalid state", { status: 400 });
  }

  try {
    const baseUrl = process.env.SHOPIFY_APP_URL || url.origin;
    const tokens = await exchangeCodeForTokens(provider, code, baseUrl, realmId);
    await saveConnection({
      shopDomain: verified.shopDomain,
      provider,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      realmId: tokens.realmId,
      tenantId: tokens.tenantId,
      expiresAt: tokens.expiresAt,
      sandbox: process.env.NODE_ENV !== "production",
    });
  } catch (error) {
    captureException(error);
    throw redirect(`/app/accounting?error=${provider.toLowerCase()}_exchange_failed`);
  }

  throw redirect(`/app/accounting?connected=${provider.toLowerCase()}`);
};
