import { describe, it, expect } from "vitest";
import type { CatalogItem } from "./catalog.server";
import {
  parseSkuQuantityText,
  resolveSkuLines,
} from "./quick-order.server";

const CATALOG: CatalogItem[] = [
  { variantId: "gid://v/1", productId: "gid://shopify/Product/gid://v/1", productTitle: "Widget", variantTitle: null, displayTitle: "Widget", sku: "A-1", price: "9.50", currencyCode: "USD" },
  { variantId: "gid://v/2", productId: "gid://shopify/Product/gid://v/2", productTitle: "Gadget", variantTitle: "Blue", displayTitle: "Gadget — Blue", sku: "B-2", price: "20.00", currencyCode: "USD" },
];

describe("parseSkuQuantityText (pure)", () => {
  it("parses comma, tab, and space separated lines", () => {
    expect(parseSkuQuantityText("A-1, 3\nB-2\t5\nC-3 2")).toEqual([
      { sku: "A-1", quantity: 3, raw: "A-1, 3" },
      { sku: "B-2", quantity: 5, raw: "B-2\t5" },
      { sku: "C-3", quantity: 2, raw: "C-3 2" },
    ]);
  });

  it("defaults quantity to 1 and skips blank lines", () => {
    expect(parseSkuQuantityText("A-1\n\n  \nB-2")).toEqual([
      { sku: "A-1", quantity: 1, raw: "A-1" },
      { sku: "B-2", quantity: 1, raw: "B-2" },
    ]);
  });
});

describe("resolveSkuLines (pure)", () => {
  it("resolves known SKUs into cart lines (case-insensitive)", () => {
    const { resolved, unresolved } = resolveSkuLines(
      parseSkuQuantityText("a-1, 3\nB-2 2"),
      CATALOG,
    );
    expect(unresolved).toEqual([]);
    expect(resolved).toEqual([
      { variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 3, price: "9.50" },
      { variantId: "gid://v/2", sku: "B-2", title: "Gadget — Blue", quantity: 2, price: "20.00" },
    ]);
  });

  it("flags unknown SKUs inline, never dropping them", () => {
    const { resolved, unresolved } = resolveSkuLines(
      parseSkuQuantityText("A-1 1\nZZZ 4"),
      CATALOG,
    );
    expect(resolved).toHaveLength(1);
    expect(unresolved).toEqual([
      { sku: "ZZZ", quantity: 4, raw: "ZZZ 4", reason: "unknown-sku" },
    ]);
  });

  it("flags invalid quantities", () => {
    const { unresolved } = resolveSkuLines(
      [{ sku: "A-1", quantity: 0, raw: "A-1 0" }],
      CATALOG,
    );
    expect(unresolved[0].reason).toBe("invalid-quantity");
  });

  it("flags empty SKUs", () => {
    const { unresolved } = resolveSkuLines(
      [{ sku: "", quantity: 2, raw: "" }],
      CATALOG,
    );
    expect(unresolved[0].reason).toBe("missing-sku");
  });

  it("partitions every row into exactly one bucket (nothing dropped)", () => {
    const rows = parseSkuQuantityText("A-1 2\nNOPE 1\nB-2 1");
    const { resolved, unresolved } = resolveSkuLines(rows, CATALOG);
    expect(resolved.length + unresolved.length).toBe(rows.length);
  });
});
