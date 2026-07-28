import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getBuyerId } from "../services/buyer-session.server";
import { buildManifest } from "../lib/pwa";
import { PWA_ENABLED } from "../services/pwa.server";

/**
 * F18 — the buyer portal's web app manifest (served at /portal/manifest.webmanifest).
 * Names the app after the buyer's shop when signed in, else a generic label.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!PWA_ENABLED()) throw new Response("Not found", { status: 404 });
  let shopName = "Mannon Wholesale";
  const buyerId = await getBuyerId(request);
  if (buyerId) {
    const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { company: { select: { name: true } } } });
    if (buyer) shopName = buyer.company.name;
  }
  const manifest = buildManifest(shopName, "/portal/icon.svg");
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300" },
  });
};
