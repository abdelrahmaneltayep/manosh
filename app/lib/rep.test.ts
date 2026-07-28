import { describe, it, expect } from "vitest";
import { repCanAccessCompany, buildRepLeaderboard, impersonationBannerText } from "./rep";
import { repPortalAllowed, evaluateRepSeatAllowance, PLAN_LIMITS } from "./billing";

describe("plan gating", () => {
  it("rep portal is Growth-only; Starter has 0 seats", () => {
    expect(repPortalAllowed("GROWTH")).toBe(true);
    expect(repPortalAllowed("Growth")).toBe(true);
    expect(repPortalAllowed("STARTER")).toBe(false);
    expect(repPortalAllowed(null)).toBe(false);
    expect(PLAN_LIMITS.starter.repSeatCap).toBe(0);
    expect(PLAN_LIMITS.growth.repSeatCap).toBe(3);
  });

  it("evaluateRepSeatAllowance allows while used < cap", () => {
    expect(evaluateRepSeatAllowance(2, 3).allowed).toBe(true);
    expect(evaluateRepSeatAllowance(3, 3).allowed).toBe(false);
    expect(evaluateRepSeatAllowance(0, 0).allowed).toBe(false); // Starter: no seats
  });
});

describe("repCanAccessCompany (strict isolation)", () => {
  it("only grants access to assigned companies", () => {
    expect(repCanAccessCompany(["c1", "c2"], "c1")).toBe(true);
    expect(repCanAccessCompany(["c1", "c2"], "c3")).toBe(false);
    expect(repCanAccessCompany([], "c1")).toBe(false);
  });
});

describe("buildRepLeaderboard", () => {
  const reps = [
    { id: "r1", name: "Ana", email: "ana@x.com" },
    { id: "r2", name: null, email: "sam@x.com" },
  ];

  it("aggregates quotes/orders and win rate per rep", () => {
    const rows = buildRepLeaderboard(reps, [
      { placedByRepId: "r1", status: "ACCEPTED" },
      { placedByRepId: "r1", status: "ORDERED" },
      { placedByRepId: "r1", status: "SUBMITTED" },
      { placedByRepId: "r2", status: "SUBMITTED" },
    ]);
    const r1 = rows.find((r) => r.repId === "r1")!;
    expect(r1).toMatchObject({ quotes: 3, orders: 2 });
    expect(r1.winRate).toBeCloseTo(2 / 3);
    const r2 = rows.find((r) => r.repId === "r2")!;
    expect(r2).toMatchObject({ quotes: 1, orders: 0, winRate: 0, name: "sam@x.com" }); // falls back to email
  });

  it("keeps reps with no quotes (0/0) and ignores unknown/absent rep ids", () => {
    const rows = buildRepLeaderboard(reps, [
      { placedByRepId: null, status: "ACCEPTED" },
      { placedByRepId: "ghost", status: "ACCEPTED" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.quotes === 0)).toBe(true);
  });

  it("sorts by orders, then quotes, then name", () => {
    const rows = buildRepLeaderboard(reps, [
      { placedByRepId: "r2", status: "ORDERED" },
      { placedByRepId: "r1", status: "SUBMITTED" },
    ]);
    expect(rows[0].repId).toBe("r2"); // 1 order beats 0
  });
});

describe("impersonationBannerText", () => {
  it("names the buyer and company", () => {
    expect(impersonationBannerText("Layla", "Gulf Medical Supplies")).toBe(
      "Ordering on behalf of Layla · Gulf Medical Supplies",
    );
  });
});
