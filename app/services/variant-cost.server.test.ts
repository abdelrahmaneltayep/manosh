import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { getVariantCosts, mapVariantCosts, type VariantCostValue } from "./variant-cost.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("mapVariantCosts (pure)", () => {
  it("maps unitCost, and yields null when Shopify has no cost", () => {
    const m = mapVariantCosts({
      nodes: [
        { id: "gid://v/1", inventoryItem: { unitCost: { amount: "3.50", currencyCode: "USD" } } },
        { id: "gid://v/2", inventoryItem: { unitCost: null } },
        null,
      ],
    });
    expect(m.get("gid://v/1")).toEqual({ costPrice: 3.5, currencyCode: "USD" });
    expect(m.get("gid://v/2")).toEqual({ costPrice: null, currencyCode: null });
    expect(m.size).toBe(2);
  });
});

describe.skipIf(!hasDb)("getVariantCosts — batching (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "VariantCost","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("serves fresh cache without hitting Shopify and fetches every miss in ONE call", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "c.myshopify.com" } });
    await prisma.variantCost.create({ data: { shopId: shop.id, variantId: "gid://v/1", costPrice: 3, currencyCode: "USD" } });

    const calls: string[][] = [];
    const loader = async (_d: string, ids: string[]): Promise<Map<string, VariantCostValue>> => {
      calls.push(ids);
      return new Map(ids.map((id) => [id, { costPrice: 9, currencyCode: "USD" }]));
    };

    // v/1 is cached-fresh; v/2 is a miss → exactly one loader call, only for v/2.
    const map = await getVariantCosts("c.myshopify.com", ["gid://v/1", "gid://v/2", "gid://v/1"], { loader });
    expect(map.get("gid://v/1")?.costPrice).toBe(3); // from cache
    expect(map.get("gid://v/2")?.costPrice).toBe(9); // fetched + upserted
    expect(calls).toEqual([["gid://v/2"]]);

    // Now both are cached → the loader is not called again.
    calls.length = 0;
    const again = await getVariantCosts("c.myshopify.com", ["gid://v/1", "gid://v/2"], { loader });
    expect(again.get("gid://v/2")?.costPrice).toBe(9);
    expect(calls).toHaveLength(0);
  });

  it("never throws when the live read fails — serves stale cache, else null", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "c.myshopify.com" } });
    await prisma.variantCost.create({ data: { shopId: shop.id, variantId: "gid://v/1", costPrice: 5, currencyCode: "USD" } });
    const boom = async () => { throw new Error("scope missing"); };
    // Force both stale by asking from far in the future.
    const map = await getVariantCosts("c.myshopify.com", ["gid://v/1", "gid://v/2"], { loader: boom, now: Date.now() + 10 * 24 * 60 * 60 * 1000 });
    expect(map.get("gid://v/1")).toEqual({ costPrice: 5, currencyCode: "USD" }); // stale cache
    expect(map.get("gid://v/2")).toEqual({ costPrice: null, currencyCode: null }); // no cache
  });
});
