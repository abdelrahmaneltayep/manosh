import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  BILLING_CONFIG,
  GROWTH_PLAN,
  PLAN_PRICING,
  STARTER_PLAN,
  TRIAL_DAYS,
  requireBilling,
  requirePlan,
  resolveActivePlan,
  planMeets,
  featureAccess,
  planEnumFor,
  planChangeEvent,
  reconcileShopPlan,
  type BillingStatus,
} from "./billing.server";

const hasDb = Boolean(process.env.DATABASE_URL);

function statusFor(plan: BillingStatus["plan"], id: string | null = null): BillingStatus {
  return {
    plan,
    hasActivePayment: plan !== null,
    onTrial: plan === null,
    activeSubscriptionName: plan,
    activeSubscriptionId: id,
  };
}

describe("billing plan configuration", () => {
  it("defines Starter $29 and Growth $79 with a 14-day trial", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(PLAN_PRICING[STARTER_PLAN]).toEqual({ amount: 29, currencyCode: "USD" });
    expect(PLAN_PRICING[GROWTH_PLAN]).toEqual({ amount: 79, currencyCode: "USD" });

    for (const plan of [STARTER_PLAN, GROWTH_PLAN] as const) {
      const config = BILLING_CONFIG[plan];
      expect(config.trialDays).toBe(14);
      expect(config.lineItems).toHaveLength(1);
      expect(config.lineItems[0].interval).toBe("EVERY_30_DAYS");
      expect(config.lineItems[0].currencyCode).toBe("USD");
    }
    expect(BILLING_CONFIG[STARTER_PLAN].lineItems[0].amount).toBe(29);
    expect(BILLING_CONFIG[GROWTH_PLAN].lineItems[0].amount).toBe(79);
  });
});

describe("resolveActivePlan", () => {
  it("reports trial when there is no active payment", () => {
    const status = resolveActivePlan(false, []);
    expect(status.plan).toBeNull();
    expect(status.onTrial).toBe(true);
    expect(status.activeSubscriptionName).toBeNull();
  });

  it("resolves an active Starter subscription", () => {
    const status = resolveActivePlan(true, [
      { id: "gid://shopify/AppSubscription/1", name: STARTER_PLAN, status: "ACTIVE" },
    ]);
    expect(status.plan).toBe(STARTER_PLAN);
    expect(status.onTrial).toBe(false);
    expect(status.activeSubscriptionId).toBe("gid://shopify/AppSubscription/1");
  });

  it("resolves an active Growth subscription", () => {
    const status = resolveActivePlan(true, [
      { name: GROWTH_PLAN, status: "ACTIVE" },
    ]);
    expect(status.plan).toBe(GROWTH_PLAN);
  });

  it("ignores non-active subscriptions", () => {
    const status = resolveActivePlan(false, [
      { name: GROWTH_PLAN, status: "CANCELLED" },
    ]);
    expect(status.plan).toBeNull();
    expect(status.onTrial).toBe(true);
  });

  it("does not map an unknown plan name to a Mannon plan", () => {
    const status = resolveActivePlan(true, [
      { name: "LegacyEnterprise", status: "ACTIVE" },
    ]);
    expect(status.plan).toBeNull();
    expect(status.activeSubscriptionName).toBe("LegacyEnterprise");
  });
});

describe("requireBilling (skeleton — reads, never enforces)", () => {
  it("returns the current plan from billing.check without redirecting", async () => {
    const check = vi.fn().mockResolvedValue({
      hasActivePayment: true,
      appSubscriptions: [{ name: GROWTH_PLAN, status: "ACTIVE" }],
    });

    const status = await requireBilling({ check }, { isTest: true });

    expect(status.plan).toBe(GROWTH_PLAN);
    expect(check).toHaveBeenCalledWith({
      plans: [STARTER_PLAN, GROWTH_PLAN],
      isTest: true,
    });
  });

  it("reports trial for a store with no active payment", async () => {
    const check = vi
      .fn()
      .mockResolvedValue({ hasActivePayment: false, appSubscriptions: [] });

    const status = await requireBilling({ check }, { isTest: true });

    expect(status.plan).toBeNull();
    expect(status.onTrial).toBe(true);
  });
});

describe("plan gating (pure)", () => {
  it("planMeets: Growth includes Starter; Starter does not include Growth", () => {
    expect(planMeets(GROWTH_PLAN, STARTER_PLAN)).toBe(true);
    expect(planMeets(GROWTH_PLAN, GROWTH_PLAN)).toBe(true);
    expect(planMeets(STARTER_PLAN, STARTER_PLAN)).toBe(true);
    expect(planMeets(STARTER_PLAN, GROWTH_PLAN)).toBe(false);
    expect(planMeets(null, STARTER_PLAN)).toBe(false);
  });

  it("featureAccess distinguishes no-plan from upgrade-required", () => {
    expect(featureAccess(statusFor(null), GROWTH_PLAN)).toEqual({
      allowed: false, reason: "no-plan", required: GROWTH_PLAN,
    });
    expect(featureAccess(statusFor(STARTER_PLAN), GROWTH_PLAN)).toEqual({
      allowed: false, reason: "upgrade-required", required: GROWTH_PLAN,
    });
    expect(featureAccess(statusFor(GROWTH_PLAN), GROWTH_PLAN).allowed).toBe(true);
    expect(featureAccess(statusFor(STARTER_PLAN), STARTER_PLAN).allowed).toBe(true);
  });
});

describe("requirePlan (enforcement)", () => {
  const growthCheck = () =>
    vi.fn().mockResolvedValue({
      hasActivePayment: true,
      appSubscriptions: [{ id: "s1", name: GROWTH_PLAN, status: "ACTIVE" }],
    });
  const starterCheck = () =>
    vi.fn().mockResolvedValue({
      hasActivePayment: true,
      appSubscriptions: [{ id: "s1", name: STARTER_PLAN, status: "ACTIVE" }],
    });

  it("returns the status when the plan is sufficient", async () => {
    const status = await requirePlan({ check: growthCheck() }, GROWTH_PLAN, { isTest: true });
    expect(status.plan).toBe(GROWTH_PLAN);
  });

  it("redirects to the upgrade hint when the plan is insufficient", async () => {
    const error = await requirePlan({ check: starterCheck() }, GROWTH_PLAN, {
      isTest: true,
    }).catch((e) => e as Response);
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(302);
    expect((error as Response).headers.get("location")).toBe(`/app/settings?upgrade=${GROWTH_PLAN}`);
  });
});

describe("plan enum + change events (pure)", () => {
  it("maps a billing status to the Prisma plan enum", () => {
    expect(planEnumFor(statusFor(GROWTH_PLAN))).toBe("GROWTH");
    expect(planEnumFor(statusFor(STARTER_PLAN))).toBe("STARTER");
    expect(planEnumFor(statusFor(null))).toBe("TRIAL");
  });

  it("names the funnel event for each transition", () => {
    expect(planChangeEvent("TRIAL", "STARTER")).toBe("TRIAL_STARTED");
    expect(planChangeEvent("TRIAL", "GROWTH")).toBe("TRIAL_STARTED");
    expect(planChangeEvent("STARTER", "GROWTH")).toBe("PLAN_UPGRADED");
    expect(planChangeEvent("CANCELLED", "STARTER")).toBe("PLAN_UPGRADED");
    expect(planChangeEvent("STARTER", "CANCELLED")).toBe("PLAN_CANCELLED");
    expect(planChangeEvent("GROWTH", "CANCELLED")).toBe("PLAN_CANCELLED");
    expect(planChangeEvent("GROWTH", "STARTER")).toBeNull(); // downgrade
    expect(planChangeEvent("TRIAL", "TRIAL")).toBeNull();
  });
});

describe.skipIf(!hasDb)("reconcileShopPlan (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedShop(domain: string, plan: "TRIAL" | "STARTER" | "GROWTH" | "CANCELLED" = "TRIAL") {
    return prisma.shop.create({ data: { shopifyDomain: domain, plan } });
  }

  it("records TRIAL_STARTED and persists the plan on first subscribe", async () => {
    const shop = await seedShop("a.myshopify.com", "TRIAL");
    const next = await reconcileShopPlan("a.myshopify.com", statusFor(STARTER_PLAN, "s1"));
    expect(next).toBe("STARTER");

    const stored = await prisma.shop.findUnique({ where: { id: shop.id } });
    expect(stored!.plan).toBe("STARTER");
    expect(await prisma.event.count({ where: { shopId: shop.id, type: "TRIAL_STARTED" } })).toBe(1);
  });

  it("records PLAN_UPGRADED on Starter → Growth", async () => {
    const shop = await seedShop("b.myshopify.com", "STARTER");
    await reconcileShopPlan("b.myshopify.com", statusFor(GROWTH_PLAN, "s2"));
    expect(await prisma.event.count({ where: { shopId: shop.id, type: "PLAN_UPGRADED" } })).toBe(1);
  });

  it("treats a lost paid plan as a cancellation", async () => {
    const shop = await seedShop("c.myshopify.com", "GROWTH");
    const next = await reconcileShopPlan("c.myshopify.com", statusFor(null));
    expect(next).toBe("CANCELLED");
    expect(await prisma.event.count({ where: { shopId: shop.id, type: "PLAN_CANCELLED" } })).toBe(1);
  });

  it("is idempotent — no event when nothing changed", async () => {
    const shop = await seedShop("d.myshopify.com", "STARTER");
    await reconcileShopPlan("d.myshopify.com", statusFor(STARTER_PLAN, "s3"));
    expect(await prisma.event.count({ where: { shopId: shop.id } })).toBe(0);
  });

  it("does not flip TRIAL to CANCELLED when there was never a paid plan", async () => {
    await seedShop("e.myshopify.com", "TRIAL");
    const next = await reconcileShopPlan("e.myshopify.com", statusFor(null));
    expect(next).toBe("TRIAL");
  });
});
