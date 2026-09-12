import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { listQuotesForBuyer, resolveCustomerEmail } from "../services/account-quotes.server";
import { QUOTE_OPS_ENABLED } from "../lib/quote-ops";
import { captureException } from "../lib/sentry.server";

/**
 * F25.5 — read-only quotes for the buyer's native customer account (Customer
 * Account UI extension). Authenticated via the customer-account session token
 * (`authenticate.public.customerAccount`), which proves a logged-in customer of
 * this shop and supplies the CORS wrapper for the extension origin. Gated to a
 * paid plan (Starter+). Read-only — the extension deep-links to the magic-link
 * portal for anything that acts.
 *
 * Identity is taken ONLY from the verified token's subject (the Customer GID),
 * resolved to an email server-side. A client-supplied email is never trusted —
 * otherwise any logged-in customer could read another buyer's quotes (IDOR).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);

  const dest = String((sessionToken as { dest?: string }).dest ?? "");
  const shopDomain = dest.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const sub = String((sessionToken as { sub?: string }).sub ?? "");
  const url = new URL(request.url);
  const portalBase = (process.env.SHOPIFY_APP_URL || url.origin).replace(/\/+$/, "") + "/portal";

  try {
    const shop = shopDomain ? await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { plan: true } }) : null;
    const paid = shop?.plan === "STARTER" || shop?.plan === "GROWTH";
    if (!QUOTE_OPS_ENABLED() || !shop || !paid || !sub) {
      return cors(json({ quotes: [], portalBase, enabled: false }));
    }

    // Trust the token, not the request: resolve the caller's OWN email.
    const email = await resolveCustomerEmail(shopDomain, sub);
    if (!email) return cors(json({ quotes: [], portalBase, enabled: false }));

    const quotes = await listQuotesForBuyer(shopDomain, email);
    return cors(json({ quotes, portalBase, enabled: true }));
  } catch (error) {
    captureException(error);
    return cors(json({ quotes: [], portalBase, enabled: false }));
  }
};
