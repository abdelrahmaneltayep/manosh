import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  getPriceListDetail,
  entriesToCsv,
  CSV_TEMPLATE,
} from "../services/price-list.server";

const ENABLED = () => process.env.MANNON_FF_PRICELISTS === "true";

// Resource route: CSV export (default) or the blank template (?template=1) as a
// download. Kept separate from the editor route so the editor loader returns a
// plain object (a Response in that loader breaks useLoaderData's types).
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  if (url.searchParams.get("template") === "1") {
    return new Response(CSV_TEMPLATE, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="price-list-template.csv"',
      },
    });
  }

  const detail = await getPriceListDetail(session.shop, params.id!);
  if (!detail) throw new Response("Price list not found", { status: 404 });

  const csv = entriesToCsv(
    detail.entries.map((e) => ({ variantId: e.variantId, price: e.price.toString() })),
    detail.breaks.map((b) => ({ variantId: b.variantId, price: b.price.toString(), minQty: b.minQty })),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${detail.list.name.replace(/\W+/g, "-")}.csv"`,
    },
  });
};
