import { describe, it, expect } from "vitest";
import { resolveV3PlanFromName } from "./billing.server";

describe("resolveV3PlanFromName — grandfathering at the billing boundary", () => {
  it("maps v3 handles to their tier with no legacy price", () => {
    expect(resolveV3PlanFromName("scale")).toEqual({ plan: "SCALE", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("growth-annual")).toEqual({ plan: "GROWTH", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("starter")).toEqual({ plan: "STARTER", legacyPlan: false, legacyPriceCents: null });
  });

  it("grandfathers the legacy capitalized names, honoring their old price", () => {
    // legacy "Starter" ($29) → STARTER enum + legacy flag + 2900¢ (caps map up to growth)
    expect(resolveV3PlanFromName("Starter")).toEqual({ plan: "STARTER", legacyPlan: true, legacyPriceCents: 2900 });
    // legacy "Growth" ($79) → GROWTH enum + legacy flag + 7900¢ (caps map up to scale)
    expect(resolveV3PlanFromName("Growth")).toEqual({ plan: "GROWTH", legacyPlan: true, legacyPriceCents: 7900 });
  });

  it("unknown / no subscription → TRIAL, no legacy", () => {
    expect(resolveV3PlanFromName(null)).toEqual({ plan: "TRIAL", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("mystery")).toEqual({ plan: "TRIAL", legacyPlan: false, legacyPriceCents: null });
  });
});
