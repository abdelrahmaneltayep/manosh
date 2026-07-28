import { describe, it, expect } from "vitest";
import { resolvePrice, pickVolumeBreak } from "./price-resolver";

describe("resolvePrice precedence", () => {
  it("falls back to the default list price when there's no list", () => {
    const r = resolvePrice(10, { listPrice: 14 });
    expect(r).toMatchObject({ price: 14, source: "default", savedPct: 0 });
  });

  it("uses the customer list-entry when set and no break applies", () => {
    const r = resolvePrice(1, { listPrice: 14, entryPrice: 12 });
    expect(r.source).toBe("list-entry");
    expect(r.price).toBe(12);
    expect(r.savedPct).toBeCloseTo((14 - 12) / 14, 5);
  });

  it("prefers a volume break over the list-entry once minQty is reached", () => {
    const r = resolvePrice(100, {
      listPrice: 14,
      entryPrice: 12,
      breaks: [{ minQty: 50, price: 10 }],
    });
    expect(r.source).toBe("volume");
    expect(r.price).toBe(10);
  });

  it("does NOT apply a break below its minQty (uses the entry instead)", () => {
    const r = resolvePrice(49, {
      listPrice: 14,
      entryPrice: 12,
      breaks: [{ minQty: 50, price: 10 }],
    });
    expect(r.source).toBe("list-entry");
    expect(r.price).toBe(12);
  });

  it("applies a break exactly at its minQty (inclusive)", () => {
    const r = resolvePrice(50, { listPrice: 14, breaks: [{ minQty: 50, price: 10 }] });
    expect(r.source).toBe("volume");
    expect(r.price).toBe(10);
  });

  it("picks the highest-minQty applicable break across tiers", () => {
    const r = resolvePrice(500, {
      listPrice: 14,
      breaks: [
        { minQty: 50, price: 11 },
        { minQty: 100, price: 10 },
        { minQty: 250, price: 9 },
      ],
    });
    expect(r.price).toBe(9);
  });

  it("breaks a minQty tie by choosing the lowest price", () => {
    expect(
      pickVolumeBreak(100, [
        { minQty: 50, price: 11 },
        { minQty: 50, price: 9.5 },
      ]),
    ).toEqual({ minQty: 50, price: 9.5 });
  });

  it("ignores non-positive / non-finite minQty breaks", () => {
    const r = resolvePrice(100, {
      listPrice: 14,
      breaks: [
        { minQty: 0, price: 1 },
        { minQty: NaN, price: 1 },
      ],
    });
    expect(r.source).toBe("default");
    expect(r.price).toBe(14);
  });

  it("computes savedPct against the list price and never goes negative", () => {
    // entry priced ABOVE list → savedPct clamps to 0, not negative
    const r = resolvePrice(1, { listPrice: 10, entryPrice: 12 });
    expect(r.savedPct).toBe(0);
  });

  it("reports 0% saved when list price is zero (avoids divide-by-zero)", () => {
    const r = resolvePrice(100, { listPrice: 0, breaks: [{ minQty: 1, price: 0 }] });
    expect(r.savedPct).toBe(0);
  });

  it("a missing entry with breaks that don't apply → default", () => {
    const r = resolvePrice(5, { listPrice: 14, entryPrice: null, breaks: [{ minQty: 50, price: 10 }] });
    expect(r.source).toBe("default");
    expect(r.price).toBe(14);
  });
});
