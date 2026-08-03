import { describe, it, expect } from "vitest";
import {
  marginPct,
  floorPriceCents,
  ruleMatches,
  pickRule,
  evaluateOffer,
  resolveAutoOutcome,
  agreedUnitPriceCents,
  type OfferDecision,
  type OfferRuleLite,
} from "./offers";

const rule = (over: Partial<OfferRuleLite> = {}): OfferRuleLite => ({
  id: "r1",
  scope: "ALL",
  scopeRef: null,
  minAcceptPctOfList: 0.9, // accept at ≥90% of list
  autoDeclineBelowPctOfList: 0.6, // decline below 60%
  autoCounterToPctOfList: 0.85, // counter to 85%
  marginFloorPct: 0.3, // never below 30% margin
  priority: 0,
  active: true,
  ...over,
});

describe("margin math", () => {
  it("computes gross margin and the floor price", () => {
    expect(marginPct(1000, 700)).toBeCloseTo(0.3);
    expect(marginPct(0, 100)).toBe(0);
    // floor price for 30% margin on a 700¢ cost = 700 / 0.7 = 1000¢
    expect(floorPriceCents(700, 0.3)).toBe(1000);
  });
});

describe("rule matching + priority", () => {
  it("ALL matches; PRODUCT matches its variant; higher priority wins", () => {
    const all = rule({ id: "all", scope: "ALL", priority: 0 });
    const prod = rule({ id: "prod", scope: "PRODUCT", scopeRef: "gid://v/1", priority: 5 });
    const ctx = { variantIds: ["gid://v/1"] };
    expect(ruleMatches(all, ctx)).toBe(true);
    expect(ruleMatches(prod, ctx)).toBe(true);
    expect(pickRule([all, prod], ctx)?.id).toBe("prod"); // priority 5 > 0
    expect(pickRule([all, prod], { variantIds: ["gid://v/9"] })?.id).toBe("all"); // prod doesn't match
    expect(pickRule([], ctx)).toBeNull();
  });
  it("ignores inactive rules", () => {
    expect(ruleMatches(rule({ active: false }), { variantIds: [] })).toBe(false);
  });
});

describe("evaluateOffer decision order", () => {
  const econ = (offeredCents: number, costCents = 500, listCents = 1000) => ({ listCents, offeredCents, costCents });

  it("auto-declines below the decline threshold", () => {
    expect(evaluateOffer(econ(550), rule()).action).toBe("decline"); // 55% < 60%
  });
  it("auto-accepts at/above the accept threshold when margin clears the floor", () => {
    const d = evaluateOffer(econ(950), rule()); // 95% ≥ 90%, margin (950-500)/950≈47% ≥ 30%
    expect(d.action).toBe("accept");
  });
  it("auto-counters in the middle band, clamped to the floor", () => {
    const d = evaluateOffer(econ(750), rule()); // 75%: between 60% and 90% → counter to 85% = 850
    expect(d.action).toBe("counter");
    expect(d.counterCents).toBe(850);
  });
  it("falls to manual with no rule", () => {
    expect(evaluateOffer(econ(750), null).action).toBe("manual");
  });
});

describe("THE INVARIANT — margin floor is never breached", () => {
  it("does NOT auto-accept an at-threshold offer whose margin is below the floor", () => {
    // cost 800, offered 950 (95% ≥ accept 90%) → margin (950-800)/950 ≈ 15.8% < 30% floor
    const d = evaluateOffer({ listCents: 1000, offeredCents: 950, costCents: 800 }, rule());
    expect(d.action).not.toBe("accept");
  });
  it("clamps an auto-counter UP to the floor price when the target would breach it", () => {
    // list 2000, cost 800, counter target 40% = 800 → margin 0% < 30%. Floor price = ceil(800/0.7) = 1143.
    const d = evaluateOffer({ listCents: 2000, offeredCents: 1400, costCents: 800 }, rule({ autoCounterToPctOfList: 0.4 }));
    expect(d.action).toBe("counter");
    expect(d.counterCents).toBe(floorPriceCents(800, 0.3)); // clamped up to 1143, not 800
    expect(marginPct(d.counterCents!, 800)).toBeGreaterThanOrEqual(0.3);
  });
  it("goes manual when even list price can't clear the floor (cost ≥ list)", () => {
    const d = evaluateOffer({ listCents: 1000, offeredCents: 900, costCents: 1000 }, rule({ autoDeclineBelowPctOfList: 0.1 }));
    expect(d.action).toBe("manual");
  });
});

describe("resolveAutoOutcome — scale automation + PWYW", () => {
  const dec = (action: OfferDecision["action"], marginAtOffer = 0.4): OfferDecision => ({ action, marginAtOffer, reason: "" });
  it("Growth never auto-executes (always pending)", () => {
    expect(resolveAutoOutcome(dec("accept"), false, 0.15)).toBe("pending");
    expect(resolveAutoOutcome(dec("decline"), false, 0.15)).toBe("pending");
  });
  it("Scale runs the decision automatically", () => {
    expect(resolveAutoOutcome(dec("decline"), true, 0.15)).toBe("declined");
    expect(resolveAutoOutcome(dec("accept"), true, 0.15)).toBe("accepted");
    expect(resolveAutoOutcome(dec("counter"), true, 0.15)).toBe("countered");
  });
  it("PWYW: a manual decision auto-accepts only when margin clears the shop floor", () => {
    expect(resolveAutoOutcome(dec("manual", 0.30), true, 0.15)).toBe("accepted"); // 30% ≥ 15%
    expect(resolveAutoOutcome(dec("manual", 0.10), true, 0.15)).toBe("pending"); // 10% < 15% → human
  });
});

describe("agreedUnitPriceCents — offer → draft order split", () => {
  it("applies the negotiated ratio uniformly to each unit list price", () => {
    // list total 1000¢, agreed 800¢ → 20% off. A 500¢ unit becomes 400¢.
    expect(agreedUnitPriceCents(500, 1000, 800)).toBe(400);
    expect(agreedUnitPriceCents(200, 1000, 800)).toBe(160);
  });
  it("full-price offer leaves unit prices unchanged", () => {
    expect(agreedUnitPriceCents(1234, 5000, 5000)).toBe(1234);
  });
  it("rounds to whole cents and never goes negative", () => {
    expect(agreedUnitPriceCents(333, 1000, 850)).toBe(283); // 333 * 0.85 = 283.05 → 283
    expect(agreedUnitPriceCents(100, 0, 0)).toBe(100); // no list total → keep unit price
  });
});
