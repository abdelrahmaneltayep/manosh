import { describe, it, expect } from "vitest";
import {
  GROWTH_FEATURES,
  PLAN_LIMITS,
  getPlanLimits,
  evaluateQuoteAllowance,
  isPaidPlan,
  quoteCaptureAllowed,
  STARTER_PLAN,
  GROWTH_PLAN,
} from "./billing";

describe("isPaidPlan (pure)", () => {
  it("treats Starter, Growth and Scale as paid — enum or display name", () => {
    for (const p of ["STARTER", "GROWTH", "SCALE", STARTER_PLAN, GROWTH_PLAN, "Scale"]) {
      expect(isPaidPlan(p)).toBe(true);
      expect(quoteCaptureAllowed(p)).toBe(true);
    }
  });

  it("treats trial, free, cancelled, unknown and missing plans as unpaid", () => {
    for (const p of ["TRIAL", "FREE", "CANCELLED", "starter", "", null, undefined]) {
      expect(isPaidPlan(p)).toBe(false);
      expect(quoteCaptureAllowed(p)).toBe(false);
    }
  });
});

describe("plan limits (pure)", () => {
  it("no feature is locked behind Growth", () => {
    expect(GROWTH_FEATURES).toEqual([]);
  });

  it("Starter is capped (50 quotes / 1 seat); Growth is unlimited / 5 seats", () => {
    expect(PLAN_LIMITS.starter).toEqual({ activeQuoteCap: 50, seatCap: 1, priceListCap: 3, savedListCap: 3, memberCap: 1, wholesaleFormCap: 1, followupCadenceMax: 1, customCatalogCap: 1, repSeatCap: 0, extraCurrencyCap: 1, localeCap: 2, reorderShortcutCap: 1 });
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

describe("isGrowthTier (Scale includes Growth)", () => {
  it("accepts Growth and Scale, stored or display names; refuses the rest", async () => {
    const { isGrowthTier, agencyAllowed } = await import("./billing");
    for (const p of ["GROWTH", "SCALE", "Growth", "Scale"]) expect(isGrowthTier(p)).toBe(true);
    for (const p of ["STARTER", "TRIAL", "FREE", "CANCELLED", "Starter", null, undefined]) expect(isGrowthTier(p as string | null)).toBe(false);
    expect(agencyAllowed("SCALE")).toBe(true);
  });

  // A feature check that compares the stored plan to "GROWTH" alone locks
  // Scale stores out of something they pay for. Checks go through
  // isGrowthTier() (or a query for both plans). The billing files are exempt:
  // they map plan names to and from Shopify rather than gate a feature.
  it("no feature check compares the plan to GROWTH alone", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const exempt = new Set(["app/services/billing.server.ts", "app/lib/billing.ts", "app/lib/billing-v3.ts"]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !exempt.has(path)) files.push(path);
      }
    };
    walk("app");
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        const comparesToGrowth = /[!=]==?\s*"GROWTH"|"GROWTH"\s*[!=]==?/.test(line);
        const growthOnlyQuery = /plan:\s*"GROWTH"/.test(line);
        if ((comparesToGrowth && !line.includes('"SCALE"')) || growthOnlyQuery) offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
