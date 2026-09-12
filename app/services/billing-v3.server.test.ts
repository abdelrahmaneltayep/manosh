import { describe, it, expect } from "vitest";
import { resolveV3PlanFromName } from "./billing.server";

describe("resolveV3PlanFromName — grandfathering at the billing boundary", () => {
  it("maps v3 handles to their tier with no legacy price", () => {
    expect(resolveV3PlanFromName("scale")).toEqual({ plan: "SCALE", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("growth-annual")).toEqual({ plan: "GROWTH", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("starter")).toEqual({ plan: "STARTER", legacyPlan: false, legacyPriceCents: null });
  });

  it("normalizes display-case managed plan names to their tier (no legacy grandfathering)", () => {
    // Managed pricing: names are case-insensitive; there are no pre-v3 shops to grandfather.
    expect(resolveV3PlanFromName("Starter")).toEqual({ plan: "STARTER", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("Growth")).toEqual({ plan: "GROWTH", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("SCALE")).toEqual({ plan: "SCALE", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("free")).toEqual({ plan: "FREE", legacyPlan: false, legacyPriceCents: null });
  });

  it("unknown / no subscription → TRIAL, no legacy", () => {
    expect(resolveV3PlanFromName(null)).toEqual({ plan: "TRIAL", legacyPlan: false, legacyPriceCents: null });
    expect(resolveV3PlanFromName("mystery")).toEqual({ plan: "TRIAL", legacyPlan: false, legacyPriceCents: null });
  });
});
