import { describe, it, expect } from "vitest";
import {
  winRate,
  avgDiscountPct,
  avgTimeToCloseHrs,
  openPipelineValue,
  computeKpis,
  topAccounts,
  dailySeries,
  discountLeaderboard,
  type QuoteRecord,
} from "./analytics-quotes";

const NOW = new Date("2026-07-27T12:00:00Z");
function rec(p: Partial<QuoteRecord>): QuoteRecord {
  return {
    id: "q",
    companyId: "c1",
    companyName: "Acme",
    status: "SUBMITTED",
    value: 100,
    discountPct: null,
    createdAt: "2026-07-27T00:00:00Z",
    closedAt: null,
    ...p,
  };
}

describe("winRate", () => {
  it("is won / (won + lost), ignoring open quotes", () => {
    const r = [
      rec({ status: "ACCEPTED" }),
      rec({ status: "ORDERED" }),
      rec({ status: "EXPIRED" }),
      rec({ status: "SUBMITTED" }),
    ];
    expect(winRate(r)).toBeCloseTo(2 / 3, 5);
  });
  it("is null when nothing has closed", () => {
    expect(winRate([rec({ status: "SUBMITTED" })])).toBeNull();
  });
});

describe("avgDiscountPct", () => {
  it("averages discount across won quotes with a known discount", () => {
    const r = [
      rec({ status: "ACCEPTED", discountPct: 0.1 }),
      rec({ status: "ORDERED", discountPct: 0.2 }),
      rec({ status: "ACCEPTED", discountPct: null }), // excluded
      rec({ status: "EXPIRED", discountPct: 0.9 }), // not won → excluded
    ];
    expect(avgDiscountPct(r)).toBeCloseTo(0.15, 5);
  });
});

describe("avgTimeToCloseHrs", () => {
  it("averages created→closed hours for won quotes", () => {
    const r = [
      rec({ status: "ACCEPTED", createdAt: "2026-07-20T00:00:00Z", closedAt: "2026-07-21T00:00:00Z" }), // 24h
      rec({ status: "ORDERED", createdAt: "2026-07-20T00:00:00Z", closedAt: "2026-07-20T12:00:00Z" }), // 12h
    ];
    expect(avgTimeToCloseHrs(r)).toBeCloseTo(18, 5);
  });
});

describe("openPipelineValue", () => {
  it("sums only open quotes", () => {
    const r = [
      rec({ status: "SUBMITTED", value: 100 }),
      rec({ status: "COUNTERED", value: 250 }),
      rec({ status: "ACCEPTED", value: 999 }),
    ];
    expect(openPipelineValue(r)).toBe(350);
  });
});

describe("topAccounts", () => {
  it("groups by company and sorts by value desc", () => {
    const r = [
      rec({ companyId: "a", companyName: "A", value: 100 }),
      rec({ companyId: "b", companyName: "B", value: 500 }),
      rec({ companyId: "a", companyName: "A", value: 100 }),
    ];
    const top = topAccounts(r, 2);
    expect(top[0]).toMatchObject({ companyId: "b", value: 500, count: 1 });
    expect(top[1]).toMatchObject({ companyId: "a", value: 200, count: 2 });
  });
});

describe("dailySeries", () => {
  it("produces one point per day across the range and bins by created date", () => {
    const s = dailySeries([rec({ createdAt: "2026-07-27T05:00:00Z", value: 100, status: "ACCEPTED" })], 30, NOW);
    expect(s).toHaveLength(30);
    expect(s[s.length - 1].date).toBe("2026-07-27");
    expect(s[s.length - 1].created).toBe(1);
    expect(s[s.length - 1].won).toBe(1);
  });
});

describe("discountLeaderboard", () => {
  it("ranks SKUs by value-weighted average discount", () => {
    const rows = discountLeaderboard([
      { variantId: "v1", title: "Beanie", discountPct: 0.2, value: 1000 },
      { variantId: "v1", title: "Beanie", discountPct: 0.1, value: 1000 },
      { variantId: "v2", title: "Tote", discountPct: 0.05, value: 500 },
    ]);
    expect(rows[0].variantId).toBe("v1");
    expect(rows[0].avgDiscountPct).toBeCloseTo(0.15, 5);
  });
});

describe("computeKpis", () => {
  it("assembles the KPI bundle", () => {
    const k = computeKpis([rec({ status: "ACCEPTED", value: 100, discountPct: 0.1, createdAt: "2026-07-26T00:00:00Z", closedAt: "2026-07-27T00:00:00Z" })]);
    expect(k.count).toBe(1);
    expect(k.won).toBe(1);
    expect(k.winRate).toBe(1);
    expect(k.avgDiscountPct).toBeCloseTo(0.1, 5);
  });
});
