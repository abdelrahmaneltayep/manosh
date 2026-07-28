import { describe, it, expect } from "vitest";
import { parseOrderPadCsv, orderPadSubtotal } from "./order-pad";

describe("parseOrderPadCsv", () => {
  it("parses sku,qty rows and skips the header", () => {
    const { rows, errors } = parseOrderPadCsv("sku,qty\nA-1,5\nB-2,2");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { sku: "A-1", qty: 5 },
      { sku: "B-2", qty: 2 },
    ]);
  });

  it("flags a bad quantity per line and keeps the good rows", () => {
    const { rows, errors } = parseOrderPadCsv("A-1,0\nB-2,3\nC-3,abc");
    expect(rows).toEqual([{ sku: "B-2", qty: 3 }]);
    expect(errors).toHaveLength(2);
  });

  it("flags a missing SKU", () => {
    expect(parseOrderPadCsv(",5").errors[0]).toMatch(/missing SKU/);
  });

  it("reports an empty file", () => {
    expect(parseOrderPadCsv("").errors[0]).toMatch(/empty/);
  });
});

describe("orderPadSubtotal", () => {
  it("sums qty × resolved unit price and reports the saving", () => {
    const s = orderPadSubtotal([
      { quantity: 100, listPrice: 14, entryPrice: 12, breaks: [{ minQty: 50, price: 10 }] }, // volume → 10
      { quantity: 2, listPrice: 9.5, entryPrice: 8 }, // list-entry → 8
    ]);
    expect(s.subtotal).toBeCloseTo(100 * 10 + 2 * 8, 5); // 1016
    expect(s.listSubtotal).toBeCloseTo(100 * 14 + 2 * 9.5, 5); // 1419
    expect(s.saved).toBeCloseTo(1419 - 1016, 5);
  });

  it("treats a zero/blank quantity as contributing nothing", () => {
    const s = orderPadSubtotal([{ quantity: 0, listPrice: 14 }]);
    expect(s.subtotal).toBe(0);
    expect(s.saved).toBe(0);
  });
});
