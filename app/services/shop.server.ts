import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { TRIAL_DAYS } from "../lib/billing";

/**
 * Shop provisioning (S20). Called from the Shopify `afterAuth` hook, so every
 * store gets a Shop row on install — the row the settings, dashboard, and plan
 * reconciliation all depend on. Emits APP_INSTALLED exactly once (the top of the
 * AARRR acquisition funnel) and starts the 14-day trial clock.
 *
 * Idempotent: afterAuth fires on every OAuth (re-auth, scope changes), not just
 * the first install, so this no-ops when the shop already exists.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function ensureShopInstalled(
  shopDomain: string,
  options: { now?: Date; trialDays?: number } = {},
): Promise<{ shopId: string; created: boolean }> {
  const existing = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (existing) return { shopId: existing.id, created: false };

  const now = options.now ?? new Date();
  const trialDays = options.trialDays ?? TRIAL_DAYS;

  try {
    const shop = await prisma.shop.create({
      data: {
        shopifyDomain: shopDomain,
        plan: "TRIAL",
        trialEndsAt: new Date(now.getTime() + trialDays * DAY_MS),
      },
    });
    await appendEvent({
      shopId: shop.id,
      type: "APP_INSTALLED",
      entityType: "Shop",
      entityId: shop.id,
      payload: { trialDays },
    });
    return { shopId: shop.id, created: true };
  } catch (error) {
    // Race: a concurrent afterAuth created the row first. Treat as existing so
    // APP_INSTALLED is still emitted exactly once (by the winning call).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const shop = await prisma.shop.findUniqueOrThrow({
        where: { shopifyDomain: shopDomain },
        select: { id: true },
      });
      return { shopId: shop.id, created: false };
    }
    throw error;
  }
}
