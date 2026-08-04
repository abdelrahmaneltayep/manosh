import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { duplicateQuote, QuoteNotFoundForShopError } from "./quote-duplicate.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("quote-duplicate.server (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "QuoteLine","Quote","Buyer","Company","Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function seedQuote() {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "qd.myshopify.com", plan: "STARTER", quoteExpiryDays: 14 } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/1", name: "Acme" } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "b@x.com" } });
    const quote = await prisma.quote.create({
      data: {
        companyId: company.id, buyerId: buyer.id, status: "ORDERED", source: "PORTAL", poReference: "PO-1",
        expiresAt: new Date("2026-01-01"), draftOrderId: "gid://shopify/DraftOrder/1",
        lines: { create: [
          { variantId: "gid://shopify/ProductVariant/1", title: "Mug", sku: "MUG", quantity: 10, price: "9.5000" },
          { variantId: "gid://shopify/ProductVariant/2", title: "Lid", sku: null, quantity: 5, price: "5.0000" },
        ] },
      },
    });
    return { shop, quote };
  }

  it("clones lines + buyer + notes into a fresh editable draft (source DUPLICATE)", async () => {
    const { quote } = await seedQuote();
    const { quoteId } = await duplicateQuote("qd.myshopify.com", quote.id, { now: new Date("2026-08-01T00:00:00Z") });
    expect(quoteId).not.toBe(quote.id);

    const dup = await prisma.quote.findUnique({ where: { id: quoteId }, include: { lines: { orderBy: { price: "desc" } } } });
    expect(dup).toMatchObject({ status: "SUBMITTED", source: "DUPLICATE", poReference: "PO-1", companyId: quote.companyId, buyerId: quote.buyerId });
    // Fresh, non-terminal: no order carried over.
    expect(dup?.draftOrderId).toBeNull();
    expect(dup?.convertedOrderId).toBeNull();
    // Expiry reset to now + 14 days.
    expect(dup?.expiresAt.toISOString().slice(0, 10)).toBe("2026-08-15");
    // Lines copied verbatim (prices preserved).
    expect(dup?.lines.map((l) => [l.title, l.quantity, l.price.toString()])).toEqual([
      ["Mug", 10, "9.5"],
      ["Lid", 5, "5"],
    ]);
    expect(await prisma.event.count({ where: { type: "QUOTE_DUPLICATED" } })).toBe(1);
  });

  it("rejects a quote from another shop", async () => {
    const { quote } = await seedQuote();
    await prisma.shop.create({ data: { shopifyDomain: "other.myshopify.com", plan: "STARTER" } });
    await expect(duplicateQuote("other.myshopify.com", quote.id)).rejects.toBeInstanceOf(QuoteNotFoundForShopError);
  });
});
