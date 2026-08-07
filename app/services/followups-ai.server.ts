import prisma from "../db.server";
import { draft, type ClaudeInvoke } from "./claude.server";

/**
 * F8 follow-ups — DB orchestration for the Claude reminder draft. Loads the
 * owned quote, computes the day context, calls draft() with the followup_message
 * feature, and returns the drafted body to pre-fill the merchant's editable
 * message field. Nothing is sent here.
 */

const ACTIVE = ["SUBMITTED", "COUNTERED"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two dates (b - a), floored, never negative below -∞. Pure. */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

export interface FollowupDraft {
  quoteId: string;
  message: string;
}

/** Draft a reminder body for one owned quote. Returns null when missing/terminal. */
export async function draftFollowupMessage(
  shopDomain: string,
  quoteId: string,
  options: { invoke?: ClaudeInvoke; now?: Date } = {},
): Promise<FollowupDraft | null> {
  const now = options.now ?? new Date();
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, company: { shop: { shopifyDomain: shopDomain } } },
    include: {
      company: { select: { name: true, shop: { select: { id: true } } } },
      buyer: { select: { name: true } },
    },
  });
  if (!quote || !ACTIVE.includes(quote.status)) return null;

  const { output } = await draft({
    feature: "followup_message",
    shopId: quote.company.shop.id,
    input: {
      companyName: quote.company.name,
      buyerName: quote.buyer.name ?? "there",
      daysSinceQuote: Math.max(0, daysBetween(quote.createdAt, now)),
      daysUntilExpiry: daysBetween(now, quote.expiresAt),
    },
    invoke: options.invoke,
  });

  const message = typeof output.message === "string" ? output.message.trim() : "";
  return { quoteId, message };
}
