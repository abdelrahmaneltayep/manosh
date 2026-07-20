import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { cancelPlan } from "./billing-actions.server";
import { GROWTH_PLAN, type BillingStatus } from "./billing.server";

const hasDb = Boolean(process.env.DATABASE_URL);

function activeStatus(id: string | null): BillingStatus {
  return {
    plan: GROWTH_PLAN,
    hasActivePayment: true,
    onTrial: false,
    activeSubscriptionName: GROWTH_PLAN,
    activeSubscriptionId: id,
  };
}

describe("cancelPlan (no DB)", () => {
  it("no-ops when there is no active subscription", async () => {
    const billing = { cancel: vi.fn() };
    const result = await cancelPlan(billing, "x.myshopify.com", activeStatus(null), {
      isTest: true,
    });
    expect(result).toEqual({ cancelled: false });
    expect(billing.cancel).not.toHaveBeenCalled();
  });
});

describe.skipIf(!hasDb)("cancelPlan (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("cancels the subscription, marks the shop CANCELLED, and records the event", async () => {
    const shop = await prisma.shop.create({
      data: { shopifyDomain: "cancel.myshopify.com", plan: "GROWTH" },
    });
    const billing = { cancel: vi.fn().mockResolvedValue({}) };

    const result = await cancelPlan(
      billing,
      "cancel.myshopify.com",
      activeStatus("gid://shopify/AppSubscription/9"),
      { isTest: true },
    );

    expect(result).toEqual({ cancelled: true });
    expect(billing.cancel).toHaveBeenCalledWith({
      subscriptionId: "gid://shopify/AppSubscription/9",
      isTest: true,
      prorate: true,
    });

    const stored = await prisma.shop.findUnique({ where: { id: shop.id } });
    expect(stored!.plan).toBe("CANCELLED");
    expect(await prisma.event.count({ where: { shopId: shop.id, type: "PLAN_CANCELLED" } })).toBe(1);
  });
});
