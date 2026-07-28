import { describe, it, expect } from "vitest";
import {
  GROWTH_FEATURES,
  PLAN_LIMITS,
  getPlanLimits,
  evaluateQuoteAllowance,
  STARTER_PLAN,
  GROWTH_PLAN,
} from "./billing";

describe("plan limits (pure)", () => {
  it("no feature is locked behind Growth", () => {
    expect(GROWTH_FEATURES).toEqual([]);
  });

  it("Starter is capped (50 quotes / 1 seat); Growth is unlimited / 5 seats", () => {
    expect(PLAN_LIMITS.starter).toEqual({ activeQuoteCap: 50, seatCap: 1, priceListCap: 3, savedListCap: 3, memberCap: 1, wholesaleFormCap: 1, followupCadenceMax: 1, customCatalogCap: 1 });
    expect(PLAN_LIMITS.growth.seatCap).toBe(5);
    expect(Number.isFinite(PLAN_LIMITS.growth.activeQuoteCap)).toBe(false);
  });

  it("getPlanLimits maps only Growth to the higher limits", () => {
    expect(getPlanLimits("GROWTH")).toBe(PLAN_LIMITS.growth);
    expect(getPlanLimits(GROWTH_PLAN)).toBe(PLAN_LIMITS.growth);
    expect(getPlanLimits("STARTER")).toBe(PLAN_LIMITS.starter);
    expect(getPlanLimits(STARTER_PLAN)).toBe(PLAN_LIMITS.starter);
    // Trial, cancelled, unknown, null all fall back to Starter limits.
    expect(getPlanLimits("TRIAL")).toBe(PLAN_LIMITS.starter);
    expect(getPlanLimits("CANCELLED")).toBe(PLAN_LIMITS.starter);
    expect(getPlanLimits(null)).toBe(PLAN_LIMITS.starter);
  });

  it("evaluateQuoteAllowance allows while used < cap", () => {
    expect(evaluateQuoteAllowance(49, 50)).toEqual({ allowed: true, used: 49, cap: 50 });
    expect(evaluateQuoteAllowance(50, 50)).toEqual({ allowed: false, used: 50, cap: 50 });
    expect(evaluateQuoteAllowance(9999, Infinity).allowed).toBe(true);
  });
});
