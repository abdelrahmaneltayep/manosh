import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { QUOTE_CAPTURE_ENABLED, getPublicForm } from "../services/quote-form.server";
import type { QuoteFormSurface } from "../lib/quote-form";
import { captureException } from "../lib/sentry.server";

/**
 * F24.1 — public config for the storefront quote form. The theme app extension
 * fetches the active form's fields for its surface and renders them. Public +
 * CORS, no secrets (just the field schema the buyer fills in). `?shop=&surface=`.
 * Returns `{ form: null }` when nothing is configured (the widget then uses its
 * built-in fields).
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60",
};

const SURFACES = new Set<QuoteFormSurface>(["PRODUCT", "COLLECTION", "CART", "PAGE"]);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const surfaceParam = (url.searchParams.get("surface") ?? "PRODUCT").toUpperCase() as QuoteFormSurface;
  const locale = url.searchParams.get("locale");
  if (!shop || !QUOTE_CAPTURE_ENABLED()) return json({ form: null }, { headers: CORS });
  const surface = SURFACES.has(surfaceParam) ? surfaceParam : "PRODUCT";
  try {
    const form = await getPublicForm(shop, surface, locale);
    return json({ form }, { headers: CORS });
  } catch (error) {
    captureException(error);
    return json({ form: null }, { headers: CORS });
  }
};
