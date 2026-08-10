import prisma from "../db.server";
import { draft } from "./claude.server";
import { getAnalytics } from "./quote-analytics.server";
import { getCatalog } from "./catalog.server";

/**
 * Server wrappers for the five dual-mode "insight" Claude features (AI-11..15).
 * Each loads the facts for the entity, calls the single `draft()` entry point,
 * and returns the validated, mapped output for the caller to render on a confirm
 * screen. None of them write to the domain — guardrail #4 (draft-only).
 */

async function shopIdFor(shopDomain: string): Promise<string> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) throw new Error("Shop not found");
  return shop.id;
}

// --- AI-12 win-rate insight (Analytics) --------------------------------------

export interface WinRateInsightResult {
  insight: string;
  suggestedAction: string;
}

/** Draft a plain-language read of the win-rate metrics + one action. Returns
 *  null when there isn't enough data to say anything useful. */
export async function draftWinRateInsight(
  shopDomain: string,
  range: number,
): Promise<WinRateInsightResult | null> {
  const analytics = await getAnalytics(shopDomain, range);
  if (!analytics || analytics.count === 0) return null;
  const shopId = await shopIdFor(shopDomain);

  const { output } = await draft({
    feature: "win_rate_insight",
    shopId,
    input: {
      periodLabel: `Last ${range} days`,
      winRatePct: Math.round((analytics.kpis.winRate ?? 0) * 100),
      prevWinRatePct: null,
      avgDiscountPct: Math.round((analytics.kpis.avgDiscountPct ?? 0) * 100),
      timeToCloseDays: analytics.kpis.avgTimeToCloseHrs
        ? Math.round((analytics.kpis.avgTimeToCloseHrs / 24) * 10) / 10
        : 0,
      quotesWon: analytics.kpis.won,
      quotesLost: analytics.kpis.lost,
    },
  });

  const insight = typeof output.insight === "string" ? output.insight.trim() : "";
  const suggestedAction = typeof output.suggestedAction === "string" ? output.suggestedAction.trim() : "";
  if (!insight) return null;
  return { insight, suggestedAction };
}

// --- AI-15 credit-risk flag (Credit) -----------------------------------------

export interface CreditRiskResult {
  level: "low" | "watch" | "high";
  rationale: string;
  recommendation: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Draft an advisory credit-risk read for one company from its payment behaviour.
 *  Read-only: never changes a limit or terms (guardrail #4). null if unknown. */
export async function draftCreditRiskFlag(
  shopDomain: string,
  companyId: string,
): Promise<(CreditRiskResult & { companyName: string }) | null> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, shop: { shopifyDomain: shopDomain } },
    select: { id: true, name: true, creditProfile: { select: { creditLimit: true, termsDays: true } } },
  });
  if (!company) return null;
  const shopId = await shopIdFor(shopDomain);

  const invoices = await prisma.invoice.findMany({
    where: { companyId },
    select: { amount: true, currency: true, status: true, dueDate: true, paidAt: true, createdAt: true },
  });
  const now = new Date();
  const outstanding = invoices
    .filter((i) => i.status === "OPEN" || i.status === "OVERDUE")
    .reduce((s, i) => s + Number(i.amount), 0);
  const overdue = invoices.filter((i) => i.status === "OVERDUE");
  const paidLate = invoices
    .filter((i) => i.status === "PAID" && i.paidAt)
    .map((i) => Math.max(0, (i.paidAt!.getTime() - i.dueDate.getTime()) / DAY_MS));
  const avgDaysLate = paidLate.length
    ? Math.round(paidLate.reduce((a, b) => a + b, 0) / paidLate.length)
    : overdue.length
      ? Math.round(overdue.reduce((a, i) => a + Math.max(0, (now.getTime() - i.dueDate.getTime()) / DAY_MS), 0) / overdue.length)
      : 0;
  const ordersLast90 = invoices.filter((i) => i.createdAt.getTime() >= now.getTime() - 90 * DAY_MS).length;
  const currency = invoices[0]?.currency ?? "USD";
  const creditLimit = company.creditProfile ? Number(company.creditProfile.creditLimit) : 0;
  const termsDays = company.creditProfile?.termsDays ?? 30;

  const { output } = await draft({
    feature: "credit_risk_flag",
    shopId,
    input: {
      companyName: company.name,
      currency,
      creditLimit: creditLimit.toFixed(2),
      outstandingBalance: outstanding.toFixed(2),
      overdueInvoices: overdue.length,
      avgDaysLate,
      termsDays,
      ordersLast90,
    },
  });

  const level = output.level === "high" || output.level === "watch" || output.level === "low" ? output.level : "watch";
  const rationale = typeof output.rationale === "string" ? output.rationale.trim() : "";
  const recommendation = typeof output.recommendation === "string" ? output.recommendation.trim() : "";
  if (!rationale) return null;
  return { level, rationale, recommendation, companyName: company.name };
}

// --- AI-14 upsell bundle (Quote detail) --------------------------------------

export interface UpsellSuggestion {
  sku: string;
  title: string;
  reason: string;
}

/** Suggest complementary catalog items to add to a quote. Guardrail: Claude may
 *  only pick from the catalog candidate list, and every returned sku is
 *  re-validated here against that list before it's surfaced (the model never
 *  invents ids). Returns [] when nothing fits; null when the quote is unknown. */
export async function draftUpsellBundle(
  shopDomain: string,
  quoteId: string,
  maxSuggestions = 3,
): Promise<UpsellSuggestion[] | null> {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, company: { shop: { shopifyDomain: shopDomain } } },
    select: { id: true, lines: { select: { sku: true, title: true } } },
  });
  if (!quote) return null;
  const shopId = await shopIdFor(shopDomain);

  const onQuote = new Set(quote.lines.map((l) => l.sku).filter(Boolean) as string[]);
  const catalog = await getCatalog(shopDomain);
  // Candidates: catalog items with a sku, not already on the quote. Cap the list
  // so the prompt stays small and cache-friendly.
  const candidates = catalog
    .filter((c) => c.sku && !onQuote.has(c.sku))
    .slice(0, 40)
    .map((c) => ({ sku: c.sku as string, title: c.displayTitle }));
  if (candidates.length === 0) return [];

  const bySku = new Map(candidates.map((c) => [c.sku, c.title]));

  const { output } = await draft({
    feature: "upsell_bundle",
    shopId,
    input: {
      currentItems: quote.lines.map((l) => ({ sku: l.sku ?? "", title: l.title })),
      candidates,
      maxSuggestions,
    },
  });

  const raw = Array.isArray(output.suggestions) ? output.suggestions : [];
  const seen = new Set<string>();
  const validated: UpsellSuggestion[] = [];
  for (const s of raw) {
    const sku = typeof s?.sku === "string" ? s.sku : "";
    const reason = typeof s?.reason === "string" ? s.reason.trim() : "";
    // Re-validate against the candidate list — drop anything invented or dup.
    if (!bySku.has(sku) || seen.has(sku)) continue;
    seen.add(sku);
    validated.push({ sku, title: bySku.get(sku)!, reason });
    if (validated.length >= maxSuggestions) break;
  }
  return validated;
}
