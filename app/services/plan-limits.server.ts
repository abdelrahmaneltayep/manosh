import prisma from "../db.server";
import {
  evaluateQuoteAllowance,
  ACTIVE_QUOTE_WINDOW_DAYS,
  type QuoteAllowance,
} from "../lib/billing";
import { PLANS, PLAN_CAPABILITIES, PLAN_DISPLAY_NAME, effectivePlanHandle, getPlanCapabilities } from "../lib/billing-v3";

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

/**
 * Count a shop's active quotes created since `since` (across all its companies).
 * A quote past its expiry date is not active even if the expiry sweep hasn't
 * marked it yet: the inbox already shows it as Expired (`isExpired`), and the
 * cap must agree with the inbox. Otherwise a Free shop is told "89 / 10 active
 * quotes" while its inbox shows none open, and buyers stay blocked.
 */
export async function countActiveQuotes(shopId: string, since: Date, now: Date = new Date()): Promise<number> {
  return prisma.quote.count({
    where: {
      company: { shopId },
      status: { in: [...ACTIVE_QUOTE_STATUSES] },
      createdAt: { gte: since },
      expiresAt: { gt: now },
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
    select: { plan: true, legacyPlan: true },
  });
  // The quote cap follows the v3 pricing ladder (the live model): Free is capped
  // (quotesCap = 10), every paid tier is unlimited. Grandfathering is honored via
  // getPlanCapabilities. (The legacy 2-plan limits wrongly capped Starter at 50.)
  const cap = getPlanCapabilities(shop?.plan ?? null, shop?.legacyPlan ?? false).quotesCap;

  if (!Number.isFinite(cap)) {
    return { allowed: true, used: 0, cap };
  }

  const since = new Date(now.getTime() - ACTIVE_QUOTE_WINDOW_DAYS * DAY_MS);
  const used = await countActiveQuotes(shopId, since, now);
  return evaluateQuoteAllowance(used, cap);
}

/**
 * Quote usage for display (Settings › Plan): the real count on every plan.
 * `canCreateQuote` skips the count on unlimited plans and reports 0, which is
 * right for enforcement but wrong on screen ("0 active quotes" on a busy store).
 * `cap` is null when the plan has no limit.
 */
export async function getQuoteUsage(
  shopId: string,
  now: Date = new Date(),
): Promise<{ used: number; cap: number | null }> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true, legacyPlan: true },
  });
  const cap = getPlanCapabilities(shop?.plan ?? null, shop?.legacyPlan ?? false).quotesCap;
  const since = new Date(now.getTime() - ACTIVE_QUOTE_WINDOW_DAYS * DAY_MS);
  const used = await countActiveQuotes(shopId, since, now);
  return { used, cap: Number.isFinite(cap) ? cap : null };
}

/**
 * Whether the merchant may reply to (price, counter, convert) this quote.
 *
 * A capped plan (Free: 10 quotes per 30 days) still RECEIVES every request, so
 * no buyer is turned away (owner decision, 27 Nov 2026). What the cap limits is
 * replying: within the window, the first `cap` active quotes can be answered and
 * any received after them wait for an upgrade, or for older quotes to expire or
 * be ordered. Unlimited plans always may reply.
 */
export async function canReplyToQuote(
  shopId: string,
  quote: { id: string; createdAt: Date },
  now: Date = new Date(),
): Promise<{ allowed: true } | { allowed: false; cap: number; message: string; upgradeTo: string }> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { plan: true, legacyPlan: true } });
  const handle = effectivePlanHandle(shop?.plan ?? null, shop?.legacyPlan ?? false);
  const cap = PLAN_CAPABILITIES[handle].quotesCap;
  if (!Number.isFinite(cap)) return { allowed: true };

  const since = new Date(now.getTime() - ACTIVE_QUOTE_WINDOW_DAYS * DAY_MS);
  const earlier = await prisma.quote.count({
    where: {
      company: { shopId },
      status: { in: [...ACTIVE_QUOTE_STATUSES] },
      createdAt: { gte: since },
      expiresAt: { gt: now },
      OR: [{ createdAt: { lt: quote.createdAt } }, { createdAt: quote.createdAt, id: { lt: quote.id } }],
    },
  });
  if (earlier < cap) return { allowed: true };

  const upgrade = PLANS.find((h) => !Number.isFinite(PLAN_CAPABILITIES[h].quotesCap)) ?? "starter";
  const planName = PLAN_DISPLAY_NAME[handle];
  const upgradeName = PLAN_DISPLAY_NAME[upgrade];
  return {
    allowed: false,
    cap,
    upgradeTo: upgrade,
    message: `This request is saved, but the ${planName} plan replies to ${cap} quotes per ${ACTIVE_QUOTE_WINDOW_DAYS} days and you’ve used them. Upgrade to ${upgradeName} to reply now, or wait until older quotes expire or are ordered.`,
  };
}

/** canReplyToQuote for a quote id, scoped to the shop. Null when the quote isn't the shop's. */
export async function replyLockFor(
  shopDomain: string,
  quoteId: string,
  now: Date = new Date(),
): Promise<{ message: string; upgradeTo: string } | null> {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, company: { shop: { shopifyDomain: shopDomain } } },
    select: { id: true, createdAt: true, company: { select: { shopId: true } } },
  });
  if (!quote) return null;
  const reply = await canReplyToQuote(quote.company.shopId, quote, now);
  return reply.allowed ? null : { message: reply.message, upgradeTo: reply.upgradeTo };
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
