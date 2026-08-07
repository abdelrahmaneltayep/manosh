import { describe, it, expect } from "vitest";
import { daysBetween } from "./followups-ai.server";
import { followupMessageFeature } from "./prompts/followup-message";

const D = (s: string) => new Date(s);

describe("daysBetween", () => {
  it("counts whole days forward", () => {
    expect(daysBetween(D("2026-08-01T00:00:00Z"), D("2026-08-08T00:00:00Z"))).toBe(7);
  });
  it("is negative when b is before a (expired)", () => {
    expect(daysBetween(D("2026-08-10T00:00:00Z"), D("2026-08-07T00:00:00Z"))).toBe(-3);
  });
});

describe("followup_message prompt", () => {
  it("includes the company, buyer, and day context", () => {
    const user = followupMessageFeature.buildUser({
      companyName: "ACME Ltd",
      buyerName: "Sam",
      daysSinceQuote: 5,
      daysUntilExpiry: 3,
    });
    expect(user).toContain("Buyer: Sam");
    expect(user).toContain("Company: ACME Ltd");
    expect(user).toContain("Days since the quote was sent: 5");
    expect(user).toContain("Days until the quote expires: 3");
  });
  it("notes expiry when the quote has lapsed", () => {
    const user = followupMessageFeature.buildUser({
      companyName: "ACME",
      buyerName: "Sam",
      daysSinceQuote: 20,
      daysUntilExpiry: -2,
    });
    expect(user).toContain("passed its expiry date");
  });
});
