import { describe, it, expect } from "vitest";
import { parseEntriesCsv, entriesToCsv } from "./price-list.server";

describe("parseEntriesCsv", () => {
  it("parses entries and volume breaks, skipping the header", () => {
    const { rows, errors } = parseEntriesCsv(
      "variant_id,price,min_qty\ngid://shopify/ProductVariant/1,12.50,\ngid://shopify/ProductVariant/1,10.00,50",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { variantId: "gid://shopify/ProductVariant/1", price: "12.50", minQty: null },
      { variantId: "gid://shopify/ProductVariant/1", price: "10.00", minQty: 50 },
    ]);
  });

  it("reports a per-line error for a bad price and skips that row", () => {
    const { rows, errors } = parseEntriesCsv("gid://x,notaprice,\ngid://y,9.99,");
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatch(/Line 1/);
  });

  it("rejects a non-integer or < 1 min_qty", () => {
    const { errors } = parseEntriesCsv("gid://x,9.99,0\ngid://y,9.99,2.5");
    expect(errors).toHaveLength(2);
  });

  it("flags an empty file", () => {
    expect(parseEntriesCsv("").errors[0]).toMatch(/empty/);
  });

  it("round-trips through entriesToCsv", () => {
    const csv = entriesToCsv(
      [{ variantId: "gid://x", price: "12.5000" }],
      [{ variantId: "gid://x", price: "10.0000", minQty: 50 }],
    );
    const { rows, errors } = parseEntriesCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });
});
