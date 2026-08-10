import { describe, it, expect } from "vitest";
import { getFeaturePrompt } from "./index";
import { reorderPredictionFeature } from "./reorder-prediction";
import { winRateInsightFeature } from "./win-rate-insight";
import { buyerSummaryFeature } from "./buyer-summary";
import { upsellBundleFeature } from "./upsell-bundle";
import { creditRiskFlagFeature } from "./credit-risk-flag";

/**
 * Pure-builder + registration coverage for the five new dual-mode Claude
 * features (AI-11..15). Each is registered under its key, forces a single tool,
 * and its buildUser carries the facts it needs (and invents nothing).
 */

describe("new AI features are registered", () => {
  it.each([
    "reorder_prediction",
    "win_rate_insight",
    "buyer_summary",
    "upsell_bundle",
    "credit_risk_flag",
  ])("%s resolves from the registry with a forced tool", (key) => {
    const f = getFeaturePrompt(key);
    expect(f).toBeDefined();
    expect(f!.key).toBe(key);
    expect(f!.tool.name).toBeTruthy();
    expect(f!.system).toContain("You DRAFT ONLY"); // shared dual-mode rulebook
  });
});

describe("reorder_prediction buildUser", () => {
  it("carries cadence numbers and usual items", () => {
    const u = reorderPredictionFeature.buildUser({
      companyName: "ACME",
      buyerName: "Sam",
      avgIntervalDays: 30,
      daysSinceLastOrder: 34,
      usualItems: ["Blue widget", "Red widget"],
    });
    expect(u).toContain("Average days between orders: 30");
    expect(u).toContain("Days since last order: 34");
    expect(u).toContain("Usually reorders: Blue widget, Red widget");
  });
  it("notes when there are no usual items", () => {
    const u = reorderPredictionFeature.buildUser({
      companyName: "ACME", buyerName: "Sam", avgIntervalDays: 30, daysSinceLastOrder: 5, usualItems: [],
    });
    expect(u).toContain("Usual items: (none provided)");
  });
});

describe("win_rate_insight buildUser", () => {
  it("includes the metrics and handles a missing previous period", () => {
    const u = winRateInsightFeature.buildUser({
      periodLabel: "Last 30 days", winRatePct: 42, prevWinRatePct: null,
      avgDiscountPct: 12, timeToCloseDays: 6, quotesWon: 8, quotesLost: 11,
    });
    expect(u).toContain("Win rate: 42%");
    expect(u).toContain("Previous period win rate: (not available)");
    expect(u).toContain("Average discount given: 12%");
  });
});

describe("buyer_summary buildUser", () => {
  it("summarizes account facts, including no-order and no-terms cases", () => {
    const u = buyerSummaryFeature.buildUser({
      companyName: "ACME", buyerName: "Sam", totalOrders: 0, totalQuotes: 2,
      openQuotes: 1, lastOrderDaysAgo: null, termsDays: null, lifetimeValue: null, currency: null,
    });
    expect(u).toContain("Total quotes: 2 (open: 1)");
    expect(u).toContain("Last order: (no orders yet)");
    expect(u).toContain("Payment terms: none set");
  });
});

describe("upsell_bundle buildUser", () => {
  it("lists current items and constrains suggestions to the candidates", () => {
    const u = upsellBundleFeature.buildUser({
      currentItems: [{ sku: "A1", title: "Widget" }],
      candidates: [{ sku: "B2", title: "Bracket" }, { sku: "C3", title: "Bolt" }],
      maxSuggestions: 2,
    });
    expect(u).toContain("- Widget (A1)");
    expect(u).toContain("suggest ONLY from these, at most 2");
    expect(u).toContain("- Bracket (B2)");
    // The tool description pins the anti-hallucination rule for SKUs.
    const skuProp = (upsellBundleFeature.tool.input_schema.properties as any).suggestions.items.properties.sku;
    expect(skuProp.description).toMatch(/verbatim from the candidate list/i);
  });
});

describe("credit_risk_flag buildUser", () => {
  it("carries the payment-behaviour numbers", () => {
    const u = creditRiskFlagFeature.buildUser({
      companyName: "ACME", currency: "USD", creditLimit: "10000", outstandingBalance: "8200",
      overdueInvoices: 2, avgDaysLate: 9, termsDays: 30, ordersLast90: 4,
    });
    expect(u).toContain("Credit limit: 10000 USD");
    expect(u).toContain("Overdue invoices: 2");
    expect(u).toContain("Average days late (paid invoices): 9");
  });
});
