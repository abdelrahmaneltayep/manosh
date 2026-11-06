import { describe, it, expect } from "vitest";
import { filterQuotes, viewCounts, paginate, viewById } from "./quote-views";

const q = (displayStatus: string, companyName: string, buyerEmail = "b@x.test") =>
  ({ displayStatus, companyName, buyerEmail }) as never;
const QUOTES = [q("SUBMITTED", "Snowdevil"), q("COUNTERED", "Powderbound"), q("ORDERED", "Snowdevil", "karine@example.com"), q("EXPIRED", "Acme")];

describe("quote views", () => {
  it("falls back to All for an unknown view id", () => {
    expect(viewById("nope").id).toBe("all");
  });
  it("Needs reply = new quotes only; Open = new + countered", () => {
    expect(filterQuotes(QUOTES, "needs-reply", "")).toHaveLength(1);
    expect(filterQuotes(QUOTES, "open", "")).toHaveLength(2);
  });
  it("searches company and buyer email within the view", () => {
    expect(filterQuotes(QUOTES, "all", "snow")).toHaveLength(2);
    expect(filterQuotes(QUOTES, "all", "KARINE")).toHaveLength(1);
    expect(filterQuotes(QUOTES, "open", "acme")).toHaveLength(0);
  });
  it("counts every view", () => {
    expect(viewCounts(QUOTES)).toMatchObject({ all: 4, "needs-reply": 1, open: 2, ordered: 1, expired: 1, accepted: 0 });
  });
  it("paginates and clamps the page", () => {
    const rows = Array.from({ length: 30 }, (_, i) => i);
    expect(paginate(rows, 2, 25)).toMatchObject({ page: 2, pages: 2, hasPrev: true, hasNext: false });
    expect(paginate(rows, 2, 25).rows).toHaveLength(5);
    expect(paginate(rows, 99, 25).page).toBe(2);
    expect(paginate([], 1).pages).toBe(1);
  });
});
