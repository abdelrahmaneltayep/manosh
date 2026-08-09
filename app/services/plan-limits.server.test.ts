import { describe, it, expect } from "vitest";
import { getPlanCapabilities } from "../lib/billing-v3";

/**
 * Regression guard for the quote-cap NUMBER that canCreateQuote() enforces.
 * canCreateQuote() reads getPlanCapabilities(plan, legacy).quotesCap, so the
 * live cap follows the v3 ladder: Free is capped at 10, every paid tier is
 * unlimited. (Before the fix it used the legacy 2-plan limits, which wrongly
 * capped Free/Starter at 50.) The DB-touching canCreateQuote itself is covered
 * by the integration tests that run only with a live Postgres.
 */
describe("quote cap number (canCreateQuote source)", () => {
  it("caps Free at 10", () => {
    expect(getPlanCapabilities("FREE").quotesCap).toBe(10);
  });

  it("is unlimited on every paid tier", () => {
    expect(getPlanCapabilities("STARTER").quotesCap).toBe(Infinity);
    expect(getPlanCapabilities("GROWTH").quotesCap).toBe(Infinity);
    expect(getPlanCapabilities("SCALE").quotesCap).toBe(Infinity);
  });

  it("trial gets Starter-level (unlimited), never the Free cap", () => {
    expect(getPlanCapabilities("TRIAL").quotesCap).toBe(Infinity);
  });

  it("a grandfathered legacy Starter is unlimited (maps up to Growth caps)", () => {
    expect(getPlanCapabilities("STARTER", true).quotesCap).toBe(Infinity);
  });
});
