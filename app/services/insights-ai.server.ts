import prisma from "../db.server";
import { draft } from "./claude.server";
import { getAnalytics } from "./quote-analytics.server";

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
