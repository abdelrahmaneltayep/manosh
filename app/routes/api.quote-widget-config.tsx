import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getWidgetConfig } from "../services/quote-widget.server";
import { captureException } from "../lib/sentry.server";

/**
 * F17 — public widget config for the theme app extension. The storefront block
 * fetches this to decide whether to render, its label, and (Growth) cart/custom
 * fields. Public + CORS: no secrets, no hidden-SKU data. `?shop=<domain>`.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return json({ enabled: false }, { headers: CORS });
  try {
    const config = await getWidgetConfig(shop);
    if (!config) return json({ enabled: false }, { headers: CORS });
    // Expose only what the storefront needs.
    return json(
      { enabled: config.enabled, label: config.label, gated: config.gated, cartEnabled: config.cartEnabled, customFields: config.customFields },
      { headers: CORS },
    );
  } catch (error) {
    // Public storefront endpoint — fail closed (widget hides) instead of 5xx.
    captureException(error);
    return json({ enabled: false }, { headers: CORS });
  }
};
