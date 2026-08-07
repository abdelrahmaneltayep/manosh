import type { Plan } from "@prisma/client";
import prisma from "../db.server";
import {
  claudeAccess,
  evaluateQuoteAllowance,
  QUOTE_WINDOW_DAYS,
  type ClaudeAccess,
  type QuoteAllowance,
} from "../config/plans";

/**
 * Server-side dual-mode guards. The pure decisions live in app/config/plans.ts;
 * this module is the thin server layer that reads the Shop row, enforces the
 * decision, and — for a Starter shop starting its one-time 7-day Claude trial —
 * persists `claudeTrialStartedAt` exactly once.
 *
 * `now` is injectable so the whole flow (including the "first use starts the
 * trial" write) stays unit-testable.
 */

export interface ShopAccessRow {
  id: string;
  plan: Plan;
  legacyPlan: boolean;
  claudeTrialStartedAt: Date | null;
}

export interface ClaudeAccessResult {
  access: ClaudeAccess;
  shop: ShopAccessRow;
}

/**
 * Resolve — and enforce — Claude access for a shop by its Shopify domain.
 * Returns the access decision plus the shop row. When the shop is a Starter that
 * hasn't started its trial, this STARTS it (persists `claudeTrialStartedAt = now`)
 * exactly once, so the 7-day clock begins on first real use.
 *
 * Throws when the shop is unknown. Does NOT throw when access is locked — the
 * caller inspects `access.allowed` and renders the upgrade nudge. Use
 * `assertClaudeAllowed` at a model-call boundary to hard-block a locked shop.
 */
export async function requireClaudeAccess(
  shopDomain: string,
  options: { now?: Date; startTrialOnUse?: boolean } = {},
): Promise<ClaudeAccessResult> {
  const now = options.now ?? new Date();
  const startTrialOnUse = options.startTrialOnUse ?? true;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, plan: true, legacyPlan: true, claudeTrialStartedAt: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  let access = claudeAccess(shop, now);

  if (access.shouldStartTrial && startTrialOnUse) {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { claudeTrialStartedAt: now },
    });
    shop.claudeTrialStartedAt = now;
    // Trial has now begun; recompute so the returned decision reflects the write.
    access = { ...claudeAccess(shop, now), shouldStartTrial: false };
  }

  return { access, shop };
}

/**
 * Hard gate for a model-call boundary: throws a 402 (payment required) when the
 * shop may not use Claude. Use this in the action that invokes `draft()`, so a
 * locked/expired shop can never reach the model even by hand-crafting a request.
 */
export function assertClaudeAllowed(access: ClaudeAccess): void {
  if (!access.allowed) {
    throw new Response("Claude drafting isn't available on this plan.", { status: 402 });
  }
}

// --- quote limit -------------------------------------------------------------

/**
 * Enforce the quote limit for a shop by domain: unlimited on every paid tier,
 * capped on Free. Counts quotes created in the rolling QUOTE_WINDOW_DAYS window
 * (through the shop's companies) and returns the pure allowance. Read-only.
 */
export async function enforceQuoteLimit(
  shopDomain: string,
  options: { now?: Date } = {},
): Promise<QuoteAllowance & { shopId: string }> {
  const now = options.now ?? new Date();
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, plan: true, legacyPlan: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const windowStart = new Date(now.getTime() - QUOTE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const used = await prisma.quote.count({
    where: { company: { shopId: shop.id }, createdAt: { gte: windowStart } },
  });

  return { ...evaluateQuoteAllowance(shop, used), shopId: shop.id };
}
