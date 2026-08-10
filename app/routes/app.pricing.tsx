import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { navFlags, firstEnabledTabUrl } from "../lib/nav";

/**
 * Parent-alias for the "Pricing & catalog" group (NAV-MIGRATION.md). /app/pricing
 * lands on the first enabled tab (Price rules by default). Keeps the tidy IA URL
 * working for bookmarks / deep links without duplicating a page.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = firstEnabledTabUrl("pricing", navFlags(process.env)) ?? "/app";
  return redirect(url);
};
