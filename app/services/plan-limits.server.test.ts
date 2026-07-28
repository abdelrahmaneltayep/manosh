import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { QuoteStatus } from "@prisma/client";
import prisma from "../db.server";
import { canCreateQuote, countActiveQuotes } from "./plan-limits.server";
import { submitBuyerQuote } from "./portal-quote.server";
import type { CatalogItem } from "./catalog.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;

const CATALOG: CatalogItem[] = [
  { variantId: "gid://v/1", productId: "gid://shopify/Product/gid://v/1", productTitle: "Widget", variantTitle: null, displayTitle: "Widget", sku: "A-1", price: "9.50", currencyCode: "USD" },
];

describe.skipIf(!hasDb)("quote-volume cap (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop","StaffSeat" RESTART IDENTITY CASCADE',
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(plan: "STARTER" | "GROWTH" | "TRIAL") {
    const shop = await prisma.shop.create({ data: { shopifyDomain: `${plan}.myshopify.com`, plan } });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: `gid://c/${plan}`, name: `Co ${plan}` },
    });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: `b@${plan}` } });
    return { shop, company, buyer };
  }

  async function seedQuotes(
    companyId: string,
    buyerId: string,
    count: number,
    status: QuoteStatus = "SUBMITTED",
    createdAt?: Date,
  ) {
    await prisma.quote.createMany({
      data: Array.from({ length: count }, () => ({
        companyId,
        buyerId,
        status,
        expiresAt: new Date(Date.now() + 14 * DAY),
        ...(createdAt ? { createdAt } : {}),
      })),
    });
  }

  it("allows creating up to the 50th and blocks the 51st on Starter", async () => {
    const { shop, company, buyer } = await seed("STARTER");

    await seedQuotes(company.id, buyer.id, 49);
    expect(await canCreateQuote(shop.id)).toEqual({ allowed: true, used: 49, cap: 50 });

    await seedQuotes(company.id, buyer.id, 1); // now 50 active exist
    expect(await canCreateQuote(shop.id)).toEqual({ allowed: false, used: 50, cap: 50 });
  });

  it("does not count ordered or expired quotes toward the cap", async () => {
    const { shop, company, buyer } = await seed("STARTER");
    await seedQuotes(company.id, buyer.id, 60, "ORDERED");
    await seedQuotes(company.id, buyer.id, 60, "EXPIRED");
    expect(await countActiveQuotes(shop.id, new Date(Date.now() - 30 * DAY))).toBe(0);
    expect((await canCreateQuote(shop.id)).allowed).toBe(true);
  });

  it("ignores quotes outside the 30-day window", async () => {
    const { shop, company, buyer } = await seed("STARTER");
    await seedQuotes(company.id, buyer.id, 50, "SUBMITTED", new Date(Date.now() - 40 * DAY));
    expect((await canCreateQuote(shop.id)).allowed).toBe(true); // all 50 are stale
  });

  it("never blocks Growth (unlimited), without even counting", async () => {
    const { shop, company, buyer } = await seed("GROWTH");
    await seedQuotes(company.id, buyer.id, 200);
    const allowance = await canCreateQuote(shop.id);
    expect(allowance.allowed).toBe(true);
    expect(Number.isFinite(allowance.cap)).toBe(false);
  });

  it("treats trial as Starter limits", async () => {
    const { shop, company, buyer } = await seed("TRIAL");
    await seedQuotes(company.id, buyer.id, 50);
    expect((await canCreateQuote(shop.id)).allowed).toBe(false);
  });

  it("integration: the 51st quote via submitBuyerQuote is blocked on Starter", async () => {
    const { company, buyer } = await seed("STARTER");
    await seedQuotes(company.id, buyer.id, 50);

    const result = await submitBuyerQuote(
      { id: buyer.id, companyId: company.id },
      [{ variantId: "gid://v/1", quantity: 3 }],
      CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.capReached).toBe(true);
      expect(result.error).toMatch(/quote request/i);
    }
    // Nothing was persisted beyond the 50 seeded.
    expect(await prisma.quote.count()).toBe(50);
  });

  it("integration: Growth is not blocked at 50 active quotes", async () => {
    const { company, buyer } = await seed("GROWTH");
    await seedQuotes(company.id, buyer.id, 50);
    const result = await submitBuyerQuote(
      { id: buyer.id, companyId: company.id },
      [{ variantId: "gid://v/1", quantity: 1 }],
      CATALOG,
    );
    expect(result.ok).toBe(true);
  });
});
