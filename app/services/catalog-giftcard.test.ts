import { describe, it, expect } from "vitest";
import { mapProductsToCatalog } from "./catalog.server";

// Gift-card products are flagged so quoting surfaces (demo seeding, order pad)
// can keep them out of draft orders. Found by the live QA run, where the demo
// quote seeded two gift cards and the accept failed.
describe("mapProductsToCatalog flags gift cards", () => {
  it("carries isGiftCard through from the product", () => {
    const items = mapProductsToCatalog({
      shop: { currencyCode: "USD" },
      products: {
        nodes: [
          { id: "gid://shopify/Product/1", title: "Gift Card", isGiftCard: true, variants: { nodes: [{ id: "gid://shopify/ProductVariant/1", sku: null, title: "$10", price: "10.00" }] } },
          { id: "gid://shopify/Product/2", title: "Snowboard", isGiftCard: false, variants: { nodes: [{ id: "gid://shopify/ProductVariant/2", sku: "SB-1", title: "Default Title", price: "911.95" }] } },
          { id: "gid://shopify/Product/3", title: "Legacy", variants: { nodes: [{ id: "gid://shopify/ProductVariant/3", sku: null, title: "Default Title", price: "1.00" }] } },
        ],
      },
    });
    expect(items.map((i) => i.isGiftCard)).toEqual([true, false, false]);
  });
});
