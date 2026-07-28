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
  /** Fraction (0.15 = 15%). AI Quote Assistant floor margin — suggestions never
   * knowingly go below this. */
  minMarginPct: number;
  /** F2 default net-terms length for new invoices (7|15|30|45|60|90). */
  defaultTermsDays: number;
}

/** Allowed net-terms lengths (shared with credit profiles). */
export const TERM_DAYS_OPTIONS = [7, 15, 30, 45, 60, 90];

export type ValidateResult =
  | { ok: true; settings: ShopSettings }
  | { ok: false; error: string };

/** Pure validation for the settings form. Tolerance is a fraction in [0, 1]. */
export function validateSettings(input: {
  autoApproveTolerance: number;
  quoteExpiryDays: number;
  magicLinkExpiryDays: number;
  minMarginPct: number;
  defaultTermsDays: number;
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
  if (
    !Number.isFinite(input.minMarginPct) ||
    input.minMarginPct < 0 ||
    input.minMarginPct > 0.95
  ) {
    return { ok: false, error: "Floor margin must be between 0% and 95%." };
  }
  if (!TERM_DAYS_OPTIONS.includes(input.defaultTermsDays)) {
    return { ok: false, error: "Default net terms must be 7, 15, 30, 45, 60, or 90 days." };
  }
  return { ok: true, settings: input };
}

// --- F2 email templates (stored on Shop.emailTemplates JSON) -----------------

export type EmailTemplateMap = Record<string, { subject?: string; body?: string }>;

export async function getEmailTemplates(shopDomain: string): Promise<EmailTemplateMap> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { emailTemplates: true },
  });
  return (shop?.emailTemplates as EmailTemplateMap | null) ?? {};
}

export async function saveEmailTemplates(
  shopDomain: string,
  templates: EmailTemplateMap,
): Promise<void> {
  await prisma.shop.update({
    where: { shopifyDomain: shopDomain },
    data: { emailTemplates: templates },
  });
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
      minMarginPct: true,
      defaultTermsDays: true,
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
      minMarginPct: true,
      defaultTermsDays: true,
    },
  });
  return updated;
}
