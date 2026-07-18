import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clearCatalogCache,
  getCatalog,
  mapProductsToCatalog,
  type CatalogItem,
} from "./catalog.server";

describe("mapProductsToCatalog (pure)", () => {
  it("flattens products→variants and builds display titles", () => {
    const items = mapProductsToCatalog({
      shop: { currencyCode: "USD" },
      products: {
        nodes: [
          {
            title: "Hoodie",
            variants: {
              nodes: [
                { id: "gid://shopify/ProductVariant/1", sku: "H-S", title: "Small", price: "40.00" },
                { id: "gid://shopify/ProductVariant/2", sku: "H-L", title: "Large", price: "42.00" },
              ],
            },
          },
          {
            title: "Sticker",
            variants: {
              nodes: [
                { id: "gid://shopify/ProductVariant/3", sku: "STK", title: "Default Title", price: "2.00" },
              ],
            },
          },
        ],
      },
    });

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      variantId: "gid://shopify/ProductVariant/1",
      displayTitle: "Hoodie — Small",
      sku: "H-S",
      price: "40.00",
      currencyCode: "USD",
    });
    // "Default Title" collapses to just the product title.
    expect(items[2].displayTitle).toBe("Sticker");
    expect(items[2].variantTitle).toBeNull();
  });

  it("defaults currency and tolerates missing nodes", () => {
    expect(mapProductsToCatalog({})).toEqual([]);
    const items = mapProductsToCatalog({
      products: { nodes: [{ title: "X", variants: { nodes: [{ id: "v", sku: null, title: "Default Title", price: "1.00" }] } }] },
    });
    expect(items[0].currencyCode).toBe("USD");
  });
});

describe("getCatalog cache", () => {
  beforeEach(() => clearCatalogCache());

  const sample: CatalogItem[] = [
    { variantId: "v1", productTitle: "P", variantTitle: null, displayTitle: "P", sku: null, price: "1.00", currencyCode: "USD" },
  ];

  it("caches within the TTL (loader runs once)", async () => {
    const loader = vi.fn().mockResolvedValue(sample);
    const t0 = 1_000_000;
    await getCatalog("shop.myshopify.com", { loader, now: t0, ttlMs: 1000 });
    await getCatalog("shop.myshopify.com", { loader, now: t0 + 500, ttlMs: 1000 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    const loader = vi.fn().mockResolvedValue(sample);
    const t0 = 1_000_000;
    await getCatalog("shop.myshopify.com", { loader, now: t0, ttlMs: 1000 });
    await getCatalog("shop.myshopify.com", { loader, now: t0 + 1500, ttlMs: 1000 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keys the cache per shop", async () => {
    const loader = vi.fn().mockResolvedValue(sample);
    const now = 1_000_000;
    await getCatalog("a.myshopify.com", { loader, now });
    await getCatalog("b.myshopify.com", { loader, now });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
