import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCatalog } from "../services/catalog.server";
import { parseCounterForm } from "../services/quote-inbox.server";
import { previewQuoteTotals } from "../services/quote-totals.server";

/**
 * TC2 — Shopify's subtotal, tax and total for a quote, as a read-only resource
 * route for the merchant quote page's "Totals from Shopify" card. A GET (via
 * fetcher.load) so it never re-runs the page loader. `edits=1` prices the
 * counter form's unsaved values (lineId, price_<id>, quantity_<id>), validated
 * by the same parser as Send counter. Nothing is created or saved.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  let edits;
  if (url.searchParams.get("edits") === "1") {
    const form = new FormData();
    for (const [key, value] of url.searchParams) form.append(key, value);
    const parsed = parseCounterForm(form);
    if (!parsed.ok) return { ok: false as const, message: parsed.error };
    edits = parsed.lines;
  }

  const catalog = await getCatalog(session.shop);
  return previewQuoteTotals({
    shopDomain: session.shop,
    quoteId: params.id!,
    admin,
    currencyCode: catalog[0]?.currencyCode ?? "USD",
    edits,
  });
};
