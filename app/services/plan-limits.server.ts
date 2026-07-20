import prisma from "../db.server";
import {
  getPlanLimits,
  evaluateQuoteAllowance,
  ACTIVE_QUOTE_WINDOW_DAYS,
  type QuoteAllowance,
} from "../lib/billing";

/**
 * Enforcement of the Starter vs Growth quote-volume limit (see app/lib/billing.ts).
 * The pure decision lives in the client-safe lib; the DB counts live here.
 *
 * "Active" = a quote in a non-terminal, live state (SUBMITTED / COUNTERED /
 * ACCEPTED) created within the rolling window. ORDERED and EXPIRED quotes do NOT
 * count toward the cap.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that count as an "active" quote for the volume cap. */
export const ACTIVE_QUOTE_STATUSES = ["SUBMITTED", "COUNTERED", "ACCEPTED"] as const;

/** Count a shop's active quotes created since `since` (across all its companies). */
export async function countActiveQuotes(shopId: string, since: Date): Promise<number> {
  return prisma.quote.count({
    where: {
      company: { shopId },
      status: { in: [...ACTIVE_QUOTE_STATUSES] },
      createdAt: { gte: since },
    },
  });
}

/**
 * Whether the shop can create another quote under its plan's volume cap.
 * Unlimited plans (Growth) short-circuit without a count.
 */
export async function canCreateQuote(
  shopId: string,
  now: Date = new Date(),
): Promise<QuoteAllowance> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });
  const { activeQuoteCap } = getPlanLimits(shop?.plan ?? null);

  if (!Number.isFinite(activeQuoteCap)) {
    return { allowed: true, used: 0, cap: activeQuoteCap };
  }

  const since = new Date(now.getTime() - ACTIVE_QUOTE_WINDOW_DAYS * DAY_MS);
  const used = await countActiveQuotes(shopId, since);
  return evaluateQuoteAllowance(used, activeQuoteCap);
}

/** Thrown by creation paths (e.g. reorder) that signal blocking via exceptions. */
export class QuoteCapReachedError extends Error {
  constructor(
    public readonly used: number,
    public readonly cap: number,
  ) {
    super(`Quote cap reached (${used}/${cap})`);
    this.name = "QuoteCapReachedError";
  }
}
