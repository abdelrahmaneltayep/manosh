import { describe, it, expect } from "vitest";
import { isWholesaleDecision } from "./wholesale-ai.server";
import { wholesaleDecisionFeature } from "./prompts/wholesale-decision";

describe("isWholesaleDecision", () => {
  it("accepts the three valid decisions", () => {
    expect(isWholesaleDecision("APPROVED")).toBe(true);
    expect(isWholesaleDecision("REJECTED")).toBe(true);
    expect(isWholesaleDecision("MORE_INFO")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isWholesaleDecision("MAYBE")).toBe(false);
    expect(isWholesaleDecision("")).toBe(false);
  });
});

describe("wholesale_decision prompt", () => {
  it("carries the company and decision and matches tone to the decision", () => {
    const approved = wholesaleDecisionFeature.buildUser({ companyName: "ACME", decision: "APPROVED" });
    expect(approved).toContain("Company: ACME");
    expect(approved).toContain("Decision: APPROVED");
    expect(approved).toContain("approved for wholesale");

    const declined = wholesaleDecisionFeature.buildUser({ companyName: "ACME", decision: "REJECTED" });
    expect(declined).toContain("decline");
  });
});
