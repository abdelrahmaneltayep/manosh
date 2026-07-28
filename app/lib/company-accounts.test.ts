import { describe, it, expect } from "vitest";
import {
  needsApproval,
  evaluateMemberAllowance,
  routeToApprovers,
  canApprove,
  canManageMembers,
} from "./company-accounts";

describe("evaluateMemberAllowance (seat enforcement)", () => {
  it("allows the first member on a cap of 1, blocks the second", () => {
    expect(evaluateMemberAllowance(0, 1).allowed).toBe(true);
    expect(evaluateMemberAllowance(1, 1).allowed).toBe(false);
  });
  it("allows up to the Growth cap of 5", () => {
    expect(evaluateMemberAllowance(4, 5).allowed).toBe(true);
    expect(evaluateMemberAllowance(5, 5).allowed).toBe(false);
  });
});

describe("needsApproval (threshold routing)", () => {
  it("routes when the total reaches the threshold", () => {
    expect(needsApproval(5000, 5000)).toBe(true);
    expect(needsApproval(5001, 5000)).toBe(true);
  });
  it("does not route below the threshold", () => {
    expect(needsApproval(4999, 5000)).toBe(false);
  });
  it("no chain when threshold is null/zero (e.g. Starter)", () => {
    expect(needsApproval(999999, null)).toBe(false);
    expect(needsApproval(999999, 0)).toBe(false);
  });
});

describe("routeToApprovers", () => {
  it("returns active admins + approvers, excluding buyers and invited members", () => {
    const emails = routeToApprovers([
      { email: "admin@co", role: "ADMIN", status: "ACTIVE" },
      { email: "appr@co", role: "APPROVER", status: "ACTIVE" },
      { email: "buyer@co", role: "BUYER", status: "ACTIVE" },
      { email: "pending@co", role: "APPROVER", status: "INVITED" },
    ]);
    expect(emails).toEqual(["admin@co", "appr@co"]);
  });
});

describe("role capabilities", () => {
  it("only admins manage members", () => {
    expect(canManageMembers("ADMIN")).toBe(true);
    expect(canManageMembers("APPROVER")).toBe(false);
    expect(canManageMembers("BUYER")).toBe(false);
  });
  it("admins and approvers can approve", () => {
    expect(canApprove("ADMIN")).toBe(true);
    expect(canApprove("APPROVER")).toBe(true);
    expect(canApprove("BUYER")).toBe(false);
  });
});
