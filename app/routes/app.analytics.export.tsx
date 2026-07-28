import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { featureAccess, GROWTH_PLAN } from "../lib/billing";
import { exportQuotesCsv } from "../services/quote-analytics.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_QUOTE_ANALYTICS === "true";

// Resource route: CSV export of the underlying quotes. Growth-gated. Kept
// separate from the dashboard loader (a Response there breaks useLoaderData).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!featureAccess(status, GROWTH_PLAN).allowed) throw new Response("Upgrade required", { status: 402 });

  const range = Number(new URL(request.url).searchParams.get("range")) === 90 ? 90 : 30;
  const csv = await exportQuotesCsv(session.shop, range);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="quotes-${range}d.csv"`,
    },
  });
};
