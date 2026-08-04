import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { listQuotesForBuyer } from "../services/account-quotes.server";
import { QUOTE_OPS_ENABLED } from "../lib/quote-ops";

/**
 * F25.5 — read-only quotes for the buyer's native customer account (Customer
 * Account UI extension). Authenticated via the customer-account session token
 * (`authenticate.public.customerAccount`), which proves a logged-in customer of
 * this shop and supplies the CORS wrapper for the extension origin. Gated to a
 * paid plan (Starter+). Read-only — the extension deep-links to the magic-link
 * portal for anything that acts.
 *
 * The buyer's email is passed by the extension (from its authenticated account
 * API) to scope the lookup. Hardening TODO: cross-check that email against the
 * token's customer identity before trusting it.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  const dest = String((sessionToken as { dest?: string }).dest ?? "");
  const shopDomain = dest.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const url = new URL(request.url);
  const email = url.searchParams.get("email") ?? "";
  const portalBase = (process.env.SHOPIFY_APP_URL || url.origin).replace(/\/+$/, "") + "/portal";

  const shop = shopDomain ? await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { plan: true } }) : null;
  const paid = shop?.plan === "STARTER" || shop?.plan === "GROWTH";
  if (!QUOTE_OPS_ENABLED() || !shop || !paid || !email) {
    return cors(Response.json({ quotes: [], portalBase, enabled: false }));
  }

  const quotes = await listQuotesForBuyer(shopDomain, email);
  return cors(Response.json({ quotes, portalBase, enabled: true }));
};
