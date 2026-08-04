import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { listQuotesForBuyer } from "./account-quotes.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("account-quotes.server (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("returns the buyer's quotes (newest first) with counts, estimate, and reorderable", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "ca.myshopify.com", plan: "STARTER" } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/1", name: "Acme" } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "Buyer@Acme.com" } });

    await prisma.quote.create({
      data: { companyId: company.id, buyerId: buyer.id, status: "SUBMITTED", source: "PORTAL", expiresAt: new Date("2030-01-01"), createdAt: new Date("2026-08-01"),
        lines: { create: [{ variantId: "gid://v/1", title: "Mug", quantity: 10, price: "9.5000" }] } },
    });
    await prisma.quote.create({
      data: { companyId: company.id, buyerId: buyer.id, status: "ORDERED", source: "PORTAL", expiresAt: new Date("2030-01-01"), createdAt: new Date("2026-08-05"),
        draftOrderId: "gid://shopify/DraftOrder/1",
        lines: { create: [{ variantId: "gid://v/2", title: "Lid", quantity: 4, price: "5.0000" }] } },
    });

    const rows = await listQuotesForBuyer("ca.myshopify.com", "buyer@acme.com");
    expect(rows).toHaveLength(2);
    // Newest first: the ORDERED quote.
    expect(rows[0]).toMatchObject({ status: "ORDERED", itemCount: 1, estimatedTotal: 20, reorderable: true });
    expect(rows[1]).toMatchObject({ status: "SUBMITTED", estimatedTotal: 95, reorderable: false });
  });

  it("is scoped to the shop + email (case-insensitive), empty otherwise", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "ca.myshopify.com", plan: "STARTER" } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/1", name: "Acme" } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "buyer@acme.com" } });
    await prisma.quote.create({ data: { companyId: company.id, buyerId: buyer.id, status: "SUBMITTED", expiresAt: new Date("2030-01-01") } });

    expect(await listQuotesForBuyer("ca.myshopify.com", "someone@else.com")).toHaveLength(0);
    expect(await listQuotesForBuyer("nope.myshopify.com", "buyer@acme.com")).toHaveLength(0);
    expect(await listQuotesForBuyer("ca.myshopify.com", "  ")).toHaveLength(0);
  });
});
