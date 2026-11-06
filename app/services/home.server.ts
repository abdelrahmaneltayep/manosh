import prisma from "../db.server";
import { EXPIRING_SOON_DAYS } from "../lib/dashboard";
import { appendEvent } from "./events.server";
import type { AttentionCounts, SetupState } from "../lib/home";

/**
 * Data for Home's "Needs your attention" list and setup guide (lib/home.ts
 * builds the rows). Counts only — read-only, indexed queries scoped to the shop.
 */
export async function getAttentionCounts(shopId: string, now = new Date()): Promise<AttentionCounts> {
  const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
  const [requests, quotesToPrice, expiringSoon, offers, applications, accessRequests, overdueInvoices, taxToVerify] =
    await Promise.all([
      prisma.quoteRequest.count({ where: { shopId, status: "NEW" } }),
      prisma.quote.count({ where: { company: { shopId }, status: "SUBMITTED" } }),
      prisma.quote.count({
        where: { company: { shopId }, status: { in: ["SUBMITTED", "COUNTERED"] }, expiresAt: { gt: now, lte: soon } },
      }),
      prisma.offer.count({ where: { shopId, status: "PENDING" } }),
      prisma.wholesaleApplication.count({ where: { shopId, status: { in: ["PENDING", "MORE_INFO"] } } }),
      prisma.catalogLead.count({ where: { publicCatalog: { shopId }, status: "NEW" } }),
      prisma.invoice.count({
        where: { company: { shopId }, OR: [{ status: "OVERDUE" }, { status: "OPEN", dueDate: { lt: now } }] },
      }),
      prisma.taxProfile.count({ where: { company: { shopId }, status: "UNVERIFIED", certificateName: { not: null } } }),
    ]);
  return { requests, quotesToPrice, expiringSoon, offers, applications, accessRequests, overdueInvoices, taxToVerify };
}

type Progress = Omit<SetupState,
  "quoteWidget" | "catalogs" | "credit" | "tax" | "i18n" | "payments" | "erp" | "accounting" | "reps" | "catalogSharing" | "growthTier" | "onPaidPlan">;

/** Which setup steps the shop has already done (the setup guide ticks them off). */
export async function getSetupProgress(shopId: string): Promise<Progress & { dismissed: boolean }> {
  const [shop, buyers, sent, catalogs, credit, erp, accounting, reps, publicCatalogs, dismissed] = await Promise.all([
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { quoteWidgetEnabled: true, defaultTaxRate: true, defaultDepositPct: true, supportedLocales: true, supportedCurrencies: true },
    }),
    prisma.buyer.count({ where: { company: { shopId }, OR: [{ magicTokenHash: { not: null } }, { invitedAt: { not: null } }] } }),
    prisma.event.count({ where: { shopId, type: "QUOTE_COUNTERED" } }),
    prisma.catalog.count({ where: { shopId, isDefault: false } }),
    prisma.creditProfile.count({ where: { company: { shopId } } }),
    prisma.erpConnection.count({ where: { shopId } }),
    prisma.accountingConnection.count({ where: { shopId } }),
    prisma.salesRep.count({ where: { shopId } }),
    prisma.publicCatalog.count({ where: { shopId } }),
    prisma.event.count({ where: { shopId, type: "SETUP_GUIDE_DISMISSED" } }),
  ]);
  const locales = (shop?.supportedLocales as string[] | null) ?? [];
  const currencies = (shop?.supportedCurrencies as string[] | null) ?? [];
  return {
    hasQuoteWidget: shop?.quoteWidgetEnabled === true,
    hasBuyer: buyers > 0,
    hasSentQuote: sent > 0,
    hasCustomCatalog: catalogs > 0,
    hasCreditProfile: credit > 0,
    hasTaxRules: shop?.defaultTaxRate != null,
    hasI18nSetup: locales.length > 1 || currencies.length > 0,
    hasDepositPolicy: shop?.defaultDepositPct != null,
    hasErpConnection: erp > 0,
    hasAccountingConnection: accounting > 0,
    hasRep: reps > 0,
    hasPublicCatalog: publicCatalogs > 0,
    dismissed: dismissed > 0,
  };
}

/** Hide the setup guide for good (append-only; recorded once). */
export async function dismissSetupGuide(shopId: string): Promise<void> {
  const already = await prisma.event.count({ where: { shopId, type: "SETUP_GUIDE_DISMISSED" } });
  if (already) return;
  await appendEvent({ shopId, type: "SETUP_GUIDE_DISMISSED", entityType: "Shop", entityId: shopId });
}
