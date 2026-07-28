import { describe, it, expect } from "vitest";
import { parseCatalogCsv } from "./catalogs.server";

describe("parseCatalogCsv", () => {
  it("parses rows, skips the header, and reads the hidden flag", () => {
    const { rows, errors } = parseCatalogCsv(
      "product_id,variant_id,hidden\n" +
        "gid://shopify/Product/1,,false\n" +
        "gid://shopify/Product/2,gid://shopify/ProductVariant/9,true\n" +
        "gid://shopify/Product/3,gid://shopify/ProductVariant/7,\n",
    );
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([
      { productId: "gid://shopify/Product/1", variantId: null, hidden: false },
      { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/9", hidden: true },
      { productId: "gid://shopify/Product/3", variantId: "gid://shopify/ProductVariant/7", hidden: false },
    ]);
  });

  it("flags a row missing product_id", () => {
    const { rows, errors } = parseCatalogCsv("product_id,variant_id,hidden\n,gid://x,true\n");
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/missing product_id/);
  });

  it("accepts common truthy spellings for hidden", () => {
    const { rows } = parseCatalogCsv("gid://shopify/Product/1,,yes\ngid://shopify/Product/2,,1");
    expect(rows.every((r) => r.hidden)).toBe(true);
  });
});
