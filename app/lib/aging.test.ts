import { describe, it, expect } from "vitest";
import {
  agingBucket,
  daysOverdue,
  bucketInvoices,
  totalOutstanding,
} from "./aging";

const NOW = new Date("2026-07-27T12:00:00Z");
const d = (iso: string) => new Date(iso);

describe("daysOverdue", () => {
  it("is negative before due, 0 on due day, positive after", () => {
    expect(daysOverdue(d("2026-07-30T12:00:00Z"), NOW)).toBe(-3);
    expect(daysOverdue(d("2026-07-27T12:00:00Z"), NOW)).toBe(0);
    expect(daysOverdue(d("2026-07-20T12:00:00Z"), NOW)).toBe(7);
  });
});

describe("agingBucket", () => {
  it("bins by how overdue an invoice is", () => {
    expect(agingBucket(d("2026-08-10"), NOW)).toBe("current"); // not due
    expect(agingBucket(d("2026-07-27T12:00:00Z"), NOW)).toBe("current"); // due today
    expect(agingBucket(d("2026-07-15"), NOW)).toBe("1-30");
    expect(agingBucket(d("2026-06-01"), NOW)).toBe("31-60");
    expect(agingBucket(d("2026-04-01"), NOW)).toBe("60+");
  });

  it("uses inclusive 30 and 60 day edges", () => {
    // exactly 30 days overdue → still 1-30
    expect(agingBucket(new Date(NOW.getTime() - 30 * 86400000), NOW)).toBe("1-30");
    // 31 days → 31-60
    expect(agingBucket(new Date(NOW.getTime() - 31 * 86400000), NOW)).toBe("31-60");
    // 61 days → 60+
    expect(agingBucket(new Date(NOW.getTime() - 61 * 86400000), NOW)).toBe("60+");
  });
});

describe("bucketInvoices", () => {
  it("sums OPEN/OVERDUE amounts into buckets and ignores PAID/VOID", () => {
    const totals = bucketInvoices(
      [
        { amount: 100, dueDate: d("2026-08-10"), status: "OPEN" }, // current
        { amount: 50, dueDate: d("2026-07-15"), status: "OVERDUE" }, // 1-30
        { amount: 999, dueDate: d("2026-07-01"), status: "PAID" }, // ignored
        { amount: 200, dueDate: d("2026-06-01"), status: "OPEN" }, // 31-60
      ],
      NOW,
    );
    expect(totals.current).toBe(100);
    expect(totals["1-30"]).toBe(50);
    expect(totals["31-60"]).toBe(200);
    expect(totals["60+"]).toBe(0);
    expect(totalOutstanding(totals)).toBe(350);
  });
});
