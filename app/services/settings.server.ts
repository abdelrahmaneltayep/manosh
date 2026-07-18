import prisma from "../db.server";

/**
 * Merchant-editable shop settings. Everything that could otherwise be a magic
 * number lives here (guardrail: nothing hardcoded that should be a setting):
 * the reorder auto-approve tolerance, quote expiry, and magic-link expiry.
 */

export interface ShopSettings {
  /** Fraction (0.05 = 5%). Reorders whose prices moved within this auto-convert. */
  autoApproveTolerance: number;
  quoteExpiryDays: number;
  magicLinkExpiryDays: number;
}

export type ValidateResult =
  | { ok: true; settings: ShopSettings }
  | { ok: false; error: string };

/** Pure validation for the settings form. Tolerance is a fraction in [0, 1]. */
export function validateSettings(input: {
  autoApproveTolerance: number;
  quoteExpiryDays: number;
  magicLinkExpiryDays: number;
}): ValidateResult {
  if (
    !Number.isFinite(input.autoApproveTolerance) ||
    input.autoApproveTolerance < 0 ||
    input.autoApproveTolerance > 1
  ) {
    return { ok: false, error: "Auto-approve tolerance must be between 0% and 100%." };
  }
  if (!Number.isInteger(input.quoteExpiryDays) || input.quoteExpiryDays < 1 || input.quoteExpiryDays > 365) {
    return { ok: false, error: "Quote expiry must be between 1 and 365 days." };
  }
  if (!Number.isInteger(input.magicLinkExpiryDays) || input.magicLinkExpiryDays < 1 || input.magicLinkExpiryDays > 90) {
    return { ok: false, error: "Magic-link expiry must be between 1 and 90 days." };
  }
  return { ok: true, settings: input };
}

export async function getShopSettings(
  shopDomain: string,
): Promise<(ShopSettings & { id: string }) | null> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: {
      id: true,
      autoApproveTolerance: true,
      quoteExpiryDays: true,
      magicLinkExpiryDays: true,
    },
  });
  return shop;
}

export async function updateShopSettings(
  shopDomain: string,
  settings: ShopSettings,
): Promise<ShopSettings> {
  const updated = await prisma.shop.update({
    where: { shopifyDomain: shopDomain },
    data: settings,
    select: {
      autoApproveTolerance: true,
      quoteExpiryDays: true,
      magicLinkExpiryDays: true,
    },
  });
  return updated;
}
