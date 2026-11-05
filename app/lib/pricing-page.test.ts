import { describe, expect, it } from "vitest";
import { comparisonRows, pricingCards } from "./pricing-page";
import { PLANS, PLAN_PRICING_V3 } from "./billing-v3";

describe("pricing page data", () => {
  it("lists the four v3 plans in ladder order with their published prices", () => {
    const cards = pricingCards();
    expect(cards.map((c) => c.handle)).toEqual([...PLANS]);
    expect(cards.map((c) => c.monthly)).toEqual(["$0", "$9", "$29", "$69"]);
    expect(cards.map((c) => c.annualTotal)).toEqual([null, "$90", "$290", "$690"]);
    // Annual = 10 × monthly, so the per-month equivalent is 10/12 of monthly.
    expect(cards.map((c) => c.annualPerMonth)).toEqual([null, "$7.50", "$24.17", "$57.50"]);
    expect(cards.map((c) => c.trialDays)).toEqual(PLANS.map((h) => PLAN_PRICING_V3[h].trialDays));
  });

  it("recommends Growth and derives bullets from the capability map", () => {
    const [free, starter, growth, scale] = pricingCards();
    expect(growth.recommended).toBe(true);
    expect(free.recommended).toBe(false);
    expect(free.bullets[0]).toBe("10 quotes per 30 days");
    expect(starter.bullets).toContain("Unlimited quotes");
    expect(starter.bullets).not.toContain("Draft with Claude counter-offers");
    expect(growth.bullets).toContain("Draft with Claude counter-offers");
    expect(growth.bullets).toContain("Net terms and credit");
    expect(scale.bullets).toContain("QuickBooks and Xero sync");
    expect(scale.bullets).toContain("White-label");
  });

  it("builds a comparison row for every plan", () => {
    const rows = comparisonRows();
    expect(rows.length).toBeGreaterThan(8);
    for (const r of rows) {
      expect(Object.keys(r.values).sort()).toEqual([...PLANS].sort());
    }
    const accounts = rows.find((r) => r.label === "Company accounts")!;
    expect(accounts.values).toEqual({ free: "1", starter: "5", growth: "25", scale: "Unlimited" });
    const trial = rows.find((r) => r.label === "Free trial")!;
    expect(trial.values.free).toBe("–");
    expect(trial.values.growth).toBe("14 days");
  });
});
