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
