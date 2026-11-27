import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLAN_CAPABILITIES, PLAN_PRICING_V3 } from "./billing-v3";
import { comparisonRows } from "./pricing-page";
import {
  FEATURE_PLAN,
  featureAvailable,
  featureGate,
  lockedMessage,
  minimumPlanName,
  shopPlanHandle,
  type PlanFeature,
} from "./plan-features";

// The App Store listing's plan section as rewritten on 27 Nov 2026. If the
// listing changes, update this block in the same change as the code, so the
// two can't drift apart unnoticed.
const LISTING = {
  free: { priceCents: 0, quotes: 10 },
  starter: { priceCents: 900, quotes: Infinity, companyAccounts: 5, priceLists: 1 },
  growth: { priceCents: 2900, companyAccounts: 25, priceLists: 10 },
  scale: { priceCents: 6900, companyAccounts: Infinity, priceLists: Infinity },
  // The plan each listed feature first appears on.
  features: {
    draftWithClaude: "growth",
    netTerms: "growth",
    deposits: "growth",
    makeAnOffer: "growth",
    offerAutomation: "scale",
    fullAnalytics: "growth",
    dealAnalytics: "scale",
    salesReps: "scale",
    accountingSync: "scale",
    whiteLabel: "scale",
  } satisfies Partial<Record<PlanFeature, string>>,
};

describe("plan features match the App Store listing (27 Nov 2026)", () => {
  it("prices and limits", () => {
    expect(PLAN_PRICING_V3.free.monthlyCents).toBe(LISTING.free.priceCents);
    expect(PLAN_PRICING_V3.starter.monthlyCents).toBe(LISTING.starter.priceCents);
    expect(PLAN_PRICING_V3.growth.monthlyCents).toBe(LISTING.growth.priceCents);
    expect(PLAN_PRICING_V3.scale.monthlyCents).toBe(LISTING.scale.priceCents);
    expect(PLAN_CAPABILITIES.free.quotesCap).toBe(LISTING.free.quotes);
    expect(PLAN_CAPABILITIES.starter.quotesCap).toBe(LISTING.starter.quotes);
    for (const h of ["starter", "growth", "scale"] as const) {
      expect(PLAN_CAPABILITIES[h].companyAccountsCap, h).toBe(LISTING[h].companyAccounts);
      expect(PLAN_CAPABILITIES[h].priceListsCap, h).toBe(LISTING[h].priceLists);
    }
  });

  it("every listed feature starts on the plan the listing names", () => {
    for (const [feature, plan] of Object.entries(LISTING.features)) {
      expect(FEATURE_PLAN[feature as PlanFeature], feature).toBe(plan);
    }
  });

  it("the in-app plan comparison agrees with the map", () => {
    const rows = comparisonRows();
    const firstWithTick = (label: string) => {
      const row = rows.find((r) => r.label === label);
      if (!row) throw new Error(`No comparison row "${label}"`);
      return (["free", "starter", "growth", "scale"] as const).find((h) => row.values[h] !== "–");
    };
    expect(firstWithTick("Sales-rep portal")).toBe(FEATURE_PLAN.salesReps);
    expect(firstWithTick("QuickBooks and Xero sync")).toBe(FEATURE_PLAN.accountingSync);
    expect(firstWithTick("White-label")).toBe(FEATURE_PLAN.whiteLabel);
    expect(firstWithTick("Net terms and credit")).toBe(FEATURE_PLAN.netTerms);
    expect(firstWithTick("Deposits and pay-by-link")).toBe(FEATURE_PLAN.deposits);
  });
});

describe("featureGate", () => {
  it("locks Scale features on Growth and names Scale", () => {
    expect(featureAvailable("salesReps", "growth")).toBe(false);
    expect(featureAvailable("salesReps", "scale")).toBe(true);
    expect(featureGate("accountingSync", "growth")).toEqual({
      available: false,
      needs: "scale",
      needsName: "Scale",
      message: "QuickBooks and Xero sync needs the Scale plan.",
    });
    expect(featureGate("whiteLabel", "scale")).toEqual({ available: true });
  });

  it("price rules start on Starter, targeting on Growth", () => {
    expect(featureAvailable("priceRules", "free")).toBe(false);
    expect(featureAvailable("priceRules", "starter")).toBe(true);
    expect(featureAvailable("priceRuleTargeting", "starter")).toBe(false);
    expect(featureAvailable("priceRuleTargeting", "growth")).toBe(true);
    expect(lockedMessage("priceRules")).toBe("Price rules needs the Starter plan.");
  });

  it("Make an Offer starts on Growth", () => {
    expect(featureAvailable("makeAnOffer", "starter")).toBe(false);
    expect(minimumPlanName("makeAnOffer")).toBe("Growth");
  });

  it("reads the tier from the stored plan, honouring grandfathering", () => {
    expect(shopPlanHandle({ plan: "SCALE" })).toBe("scale");
    expect(shopPlanHandle({ plan: "GROWTH", legacyPlan: true })).toBe("scale");
    expect(shopPlanHandle({ plan: "TRIAL" })).toBe("free");
    expect(shopPlanHandle(null)).toBe("free");
  });
});

// A lock message or upgrade button that names a plan must take the name from
// the map. These phrases were hard-coded before and named Growth for features
// that need Scale.
describe("no hard-coded plan for the Scale features", () => {
  it("routes and services don't call reps, accounting, white-label or agency a Growth feature", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) files.push(path);
      }
    };
    walk("app/routes");
    walk("app/services");
    const offenders: string[] = [];
    const bad = /(sales-rep portal|rep portal|Accounting sync|Agency mode|White-label|catalog sharing|shareable wholesale catalog)[^"`\n]{0,40}(is a|needs the|included on the) Growth|Growth \((Agency)\) feature|its own Growth plan/i;
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (bad.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
