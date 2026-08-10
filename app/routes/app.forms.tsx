import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { navFlags, firstEnabledTabUrl } from "../lib/nav";

/**
 * Parent-alias for the "Quote forms" group (NAV-MIGRATION.md). /app/forms lands
 * on the first enabled tab (Quote forms by default, else Languages).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = firstEnabledTabUrl("forms", navFlags(process.env)) ?? "/app";
  return redirect(url);
};
