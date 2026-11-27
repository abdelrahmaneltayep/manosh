import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { whiteLabelAllowed } from "../lib/billing";
import { lockedMessage } from "../lib/plan-features";
import { validateBranding, resolveBrandingTokens, type BrandingInput, type BrandingTokens } from "../lib/branding";

/**
 * F20 — per-store white-label branding for BUYER-FACING pages only (portal +
 * emails). Never touches the embedded Shopify admin. Scale only; colors are
 * AA-contrast-validated before storage. Dark-launched behind MANNON_FF_WHITE_LABEL.
 */

export const WHITE_LABEL_ENABLED = () => process.env.MANNON_FF_WHITE_LABEL === "true";

export class NotAllowedError extends Error {}

export async function getBranding(shopDomain: string) {
  return prisma.branding.findUnique({ where: { shop: shopDomain } });
}

/**
 * The effective buyer-facing tokens for a shop (Branding over Mannon defaults).
 * Always returns something safe. When the flag is off, returns the plain Mannon
 * defaults so nothing changes for existing buyers.
 */
export async function getBrandingTokens(shopDomain: string): Promise<BrandingTokens> {
  if (!WHITE_LABEL_ENABLED()) return resolveBrandingTokens(null);
  // White-label is a Scale feature: after a downgrade the saved branding is
  // kept but paused, so the portal, PDFs and messages go back to the defaults.
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { plan: true, legacyPlan: true } });
  if (!whiteLabelAllowed(shop?.plan ?? null, shop?.legacyPlan ?? false)) return resolveBrandingTokens(null);
  const branding = await getBranding(shopDomain);
  return resolveBrandingTokens(branding);
}

export async function saveBranding(
  shopDomain: string,
  input: BrandingInput,
  plan: string | null,
  legacyPlan = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!whiteLabelAllowed(plan, legacyPlan)) throw new NotAllowedError(lockedMessage("whiteLabel"));
  const v = validateBranding(input);
  if (!v.ok) return { ok: false, error: v.error ?? "Please check the branding." };

  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return { ok: false, error: "Unknown shop." };

  await prisma.branding.upsert({
    where: { shop: shopDomain },
    create: {
      shop: shopDomain,
      primaryColor: v.primaryColor,
      accentColor: v.accentColor,
      portalName: v.portalName,
      logoFileId: v.logoFileId,
    },
    update: {
      primaryColor: v.primaryColor,
      accentColor: v.accentColor,
      portalName: v.portalName,
      logoFileId: v.logoFileId,
    },
  });

  await appendEvent({
    shopId: shop.id,
    type: "BRANDING_UPDATED",
    entityType: "Branding",
    entityId: shopDomain,
    payload: { hasPrimary: Boolean(v.primaryColor), hasAccent: Boolean(v.accentColor), hasName: Boolean(v.portalName) },
  });
  return { ok: true };
}
