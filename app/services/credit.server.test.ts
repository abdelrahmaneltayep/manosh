import { describe, it, expect } from "vitest";
import { evaluateCredit, creditBlockMessage, validateCreditProfile } from "./credit.server";

describe("evaluateCredit", () => {
  it("blocks a company on hold regardless of numbers", () => {
    const d = evaluateCredit({ status: "HOLD", creditLimit: 10000, outstanding: 0, newOrderAmount: 1 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("on-hold");
  });

  it("allows when no limit is set (0 = unlimited)", () => {
    const d = evaluateCredit({ status: "ACTIVE", creditLimit: 0, outstanding: 99999, newOrderAmount: 99999 });
    expect(d.allowed).toBe(true);
  });

  it("allows when projected total is within the limit", () => {
    const d = evaluateCredit({ status: "ACTIVE", creditLimit: 5000, outstanding: 2000, newOrderAmount: 1000 });
    expect(d.allowed).toBe(true);
  });

  it("blocks when outstanding + new order exceeds the limit", () => {
    const d = evaluateCredit({ status: "ACTIVE", creditLimit: 5000, outstanding: 4500, newOrderAmount: 1000 });
    expect(d.allowed).toBe(false);
    if (!d.allowed && d.reason === "over-limit") {
      expect(d.projected).toBe(5500);
      expect(d.limit).toBe(5000);
    } else {
      throw new Error("expected over-limit");
    }
  });

  it("allows exactly at the limit (not a breach)", () => {
    const d = evaluateCredit({ status: "ACTIVE", creditLimit: 5000, outstanding: 4000, newOrderAmount: 1000 });
    expect(d.allowed).toBe(true);
  });
});

describe("creditBlockMessage", () => {
  it("is null when allowed", () => {
    expect(creditBlockMessage({ allowed: true, reason: "ok" })).toBeNull();
  });
  it("explains an over-limit block", () => {
    const msg = creditBlockMessage({ allowed: false, reason: "over-limit", outstanding: 4500, limit: 5000, projected: 5500 });
    expect(msg).toContain("over its credit limit");
  });
});

describe("validateCreditProfile", () => {
  it("accepts a valid profile", () => {
    expect(validateCreditProfile({ creditLimit: 5000, termsDays: 30, status: "ACTIVE" }).ok).toBe(true);
  });
  it("rejects a non-standard term", () => {
    expect(validateCreditProfile({ creditLimit: 5000, termsDays: 20, status: "ACTIVE" }).ok).toBe(false);
  });
  it("rejects a negative limit", () => {
    expect(validateCreditProfile({ creditLimit: -1, termsDays: 30, status: "ACTIVE" }).ok).toBe(false);
  });
});
