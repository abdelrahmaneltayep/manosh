import { describe, it, expect } from "vitest";
import {
  PLANS,
  planIndex,
  meetsPlan,
  PLAN_PRICING_V3,
  PLAN_CAPABILITIES,
  getPlanCapabilities,
  effectivePlanHandle,
  selectedPlanHandle,
  resolveGrandfather,
  prismaPlanForHandle,
  formatPriceCents,
  NO_PER_ORDER_FEES_COPY,
} from "./billing-v3";

describe("plan ladder", () => {
  it("is ordered free < starter < growth < scale", () => {
    expect(PLANS).toEqual(["free", "starter", "growth", "scale"]);
    expect(planIndex("free")).toBeLessThan(planIndex("starter"));
    expect(meetsPlan("growth", "starter")).toBe(true);
    expect(meetsPlan("starter", "growth")).toBe(false);
    expect(meetsPlan("scale", "scale")).toBe(true);
  });
});

describe("pricing undercuts the field", () => {
  it("is $0 / $9 / $29 / $69 monthly, annual = 2 months free", () => {
    expect(PLAN_PRICING_V3.free.monthlyCents).toBe(0);
    expect(PLAN_PRICING_V3.starter.monthlyCents).toBe(900);
    expect(PLAN_PRICING_V3.growth.monthlyCents).toBe(2900);
    expect(PLAN_PRICING_V3.scale.monthlyCents).toBe(6900);
    // annual = 10× monthly
    expect(PLAN_PRICING_V3.starter.annualCents).toBe(9000);
    expect(PLAN_PRICING_V3.growth.annualCents).toBe(29000);
    expect(PLAN_PRICING_V3.scale.annualCents).toBe(69000);
  });
  it("formats cents as clean dollar strings", () => {
    expect(formatPriceCents(0)).toBe("$0");
    expect(formatPriceCents(900)).toBe("$9");
    expect(formatPriceCents(6900)).toBe("$69");
  });
  it("keeps the flat-fee trust message", () => {
    expect(NO_PER_ORDER_FEES_COPY.toLowerCase()).toContain("no per-order fees");
  });
});

describe("capability map (§1.3)", () => {
  it("gates AI counter, net terms, deposits to growth+", () => {
    expect(PLAN_CAPABILITIES.free.aiCounter).toBe(false);
    expect(PLAN_CAPABILITIES.starter.aiCounter).toBe(false);
    expect(PLAN_CAPABILITIES.growth.aiCounter).toBe(true);
    expect(PLAN_CAPABILITIES.growth.netTerms).toBe(true);
    expect(PLAN_CAPABILITIES.growth.deposits).toBe(true);
  });
  it("gates sales-rep, accounting, white-label to scale only", () => {
    expect(PLAN_CAPABILITIES.growth.salesRep).toBe(false);
    expect(PLAN_CAPABILITIES.scale.salesRep).toBe(true);
    expect(PLAN_CAPABILITIES.scale.accountingSync).toBe(true);
    expect(PLAN_CAPABILITIES.scale.whiteLabel).toBe(true);
    expect(PLAN_CAPABILITIES.growth.whiteLabel).toBe(false);
  });
  it("tiers Make-an-Offer teaser → manual(3) → auto(unlimited)", () => {
    expect(PLAN_CAPABILITIES.free.makeAnOffer).toBe("teaser");
    expect(PLAN_CAPABILITIES.growth.makeAnOffer).toBe("manual");
    expect(PLAN_CAPABILITIES.growth.offerRuleCap).toBe(3);
    expect(PLAN_CAPABILITIES.scale.makeAnOffer).toBe("auto");
    expect(PLAN_CAPABILITIES.scale.offerRuleCap).toBe(Infinity);
  });
  it("free caps quotes at 10/mo; paid tiers unlimited", () => {
    expect(PLAN_CAPABILITIES.free.quotesCap).toBe(10);
    expect(PLAN_CAPABILITIES.starter.quotesCap).toBe(Infinity);
  });
});

describe("grandfathering — nobody's price is silently raised", () => {
  it("legacy Starter ($29) → growth capabilities, price honored", () => {
    const g = resolveGrandfather("STARTER");
    expect(g).toEqual({ legacyPlan: true, legacyPriceCents: 2900, capabilityHandle: "growth" });
    // and its capabilities map UP to growth
    expect(getPlanCapabilities("STARTER", true).aiCounter).toBe(true);
    expect(effectivePlanHandle("STARTER", true)).toBe("growth");
  });
  it("legacy Growth ($79) → scale capabilities, price honored", () => {
    const g = resolveGrandfather("GROWTH");
    expect(g).toEqual({ legacyPlan: true, legacyPriceCents: 7900, capabilityHandle: "scale" });
    expect(getPlanCapabilities("GROWTH", true).whiteLabel).toBe(true);
    expect(effectivePlanHandle("GROWTH", true)).toBe("scale");
  });
  it("a fresh v3 shop maps by its own tier (no legacy price)", () => {
    expect(resolveGrandfather("GROWTH")).toBeTruthy(); // legacy path above
    expect(resolveGrandfather("FREE")).toEqual({ legacyPlan: false, legacyPriceCents: null, capabilityHandle: "free" });
    expect(effectivePlanHandle("GROWTH", false)).toBe("growth"); // non-legacy growth = growth caps ($29)
    expect(effectivePlanHandle("SCALE", false)).toBe("scale");
  });
  // App Store review 1.2.2: a fresh install has no subscription in Shopify, so
  // the app must not grant (or show) a paid tier on its own.
  it("no plan selected (TRIAL), cancelled and unknown all get Free access", () => {
    expect(effectivePlanHandle("TRIAL", false)).toBe("free");
    expect(effectivePlanHandle("CANCELLED", false)).toBe("free");
    expect(effectivePlanHandle(null, false)).toBe("free");
  });
  it("selectedPlanHandle is null until Shopify holds a plan, so nothing shows as Current", () => {
    expect(selectedPlanHandle("TRIAL")).toBeNull();
    expect(selectedPlanHandle("CANCELLED")).toBeNull();
    expect(selectedPlanHandle(null)).toBeNull();
    expect(selectedPlanHandle("FREE")).toBe("free");
    expect(selectedPlanHandle("STARTER")).toBe("starter");
    expect(selectedPlanHandle("GROWTH")).toBe("growth");
    expect(selectedPlanHandle("SCALE")).toBe("scale");
    expect(selectedPlanHandle("STARTER", true)).toBe("growth"); // grandfathered maps up
  });
  it("handle ↔ Prisma enum round-trips", () => {
    expect(prismaPlanForHandle("scale")).toBe("SCALE");
    expect(prismaPlanForHandle("free")).toBe("FREE");
  });
});
