import { describe, it, expect, vi } from "vitest";
import {
  BILLING_CONFIG,
  GROWTH_PLAN,
  PLAN_PRICING,
  STARTER_PLAN,
  TRIAL_DAYS,
  requireBilling,
  resolveActivePlan,
} from "./billing.server";

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
      { name: STARTER_PLAN, status: "ACTIVE" },
    ]);
    expect(status.plan).toBe(STARTER_PLAN);
    expect(status.onTrial).toBe(false);
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
