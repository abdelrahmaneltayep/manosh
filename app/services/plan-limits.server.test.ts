import { describe, it, expect } from "vitest";
import { getPlanCapabilities } from "../lib/billing-v3";

/**
 * Regression guard for the quote-cap NUMBER that canCreateQuote() enforces.
 * canCreateQuote() reads getPlanCapabilities(plan, legacy).quotesCap, so the
 * live cap follows the v3 ladder: Free is capped at 10, every paid tier is
 * unlimited. (Before the fix it used the legacy 2-plan limits, which wrongly
 * capped Free/Starter at 50.) The DB-touching canCreateQuote itself is covered
 * by the integration tests that run only with a live Postgres.
 */
describe("quote cap number (canCreateQuote source)", () => {
  it("caps Free at 10", () => {
    expect(getPlanCapabilities("FREE").quotesCap).toBe(10);
  });

  it("is unlimited on every paid tier", () => {
    expect(getPlanCapabilities("STARTER").quotesCap).toBe(Infinity);
    expect(getPlanCapabilities("GROWTH").quotesCap).toBe(Infinity);
    expect(getPlanCapabilities("SCALE").quotesCap).toBe(Infinity);
  });

  it("no plan selected (TRIAL) gets the Free cap: paid limits start with a Shopify plan", () => {
    expect(getPlanCapabilities("TRIAL").quotesCap).toBe(getPlanCapabilities("FREE").quotesCap);
  });

  it("a grandfathered legacy Starter is unlimited (maps up to Growth caps)", () => {
    expect(getPlanCapabilities("STARTER", true).quotesCap).toBe(Infinity);
  });
});

// --- display usage (Settings › Plan) -----------------------------------------
import { beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { submitQuote } from "./quote.server";
import { canCreateQuote, getQuoteUsage } from "./plan-limits.server";

describe.skipIf(!process.env.DATABASE_URL)("getQuoteUsage (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function shopWithQuotes(domain: string, plan: "FREE" | "GROWTH", quotes: number) {
    const shop = await prisma.shop.create({ data: { shopifyDomain: domain, plan } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: `gid://c/${domain}`, name: "Co" } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: `b@${domain}` } });
    for (let i = 0; i < quotes; i++) {
      await submitQuote({
        companyId: company.id,
        buyerId: buyer.id,
        lines: [{ variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 1, price: "9.50" }],
      });
    }
    return shop;
  }

  it("reports the real count on an unlimited plan (not the 0 enforcement returns)", async () => {
    const shop = await shopWithQuotes("usage-growth.myshopify.com", "GROWTH", 2);
    expect(await getQuoteUsage(shop.id)).toEqual({ used: 2, cap: null });
    expect((await canCreateQuote(shop.id)).allowed).toBe(true);
  });

  it("a quote past its expiry date no longer counts, even before the sweep marks it", async () => {
    const shop = await shopWithQuotes("usage-stale.myshopify.com", "FREE", 3);
    const company = await prisma.company.findFirstOrThrow({ where: { shopId: shop.id } });
    const stale = await prisma.quote.findFirstOrThrow({ where: { companyId: company.id } });
    await prisma.quote.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
    expect(await getQuoteUsage(shop.id)).toEqual({ used: 2, cap: 10 });
    expect((await canCreateQuote(shop.id)).used).toBe(2);
  });

  it("reports the count against the cap on Free", async () => {
    const shop = await shopWithQuotes("usage-free.myshopify.com", "FREE", 1);
    expect(await getQuoteUsage(shop.id)).toEqual({ used: 1, cap: 10 });
  });
});
