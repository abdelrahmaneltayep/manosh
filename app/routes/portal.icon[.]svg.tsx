import { brandIconSvg } from "../lib/pwa";
import { PWA_ENABLED } from "../services/pwa.server";

/** F18 — the buyer PWA app icon (brand tokens), served at /portal/icon.svg. */
export const loader = () => {
  if (!PWA_ENABLED()) throw new Response("Not found", { status: 404 });
  return new Response(brandIconSvg(), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" },
  });
};
