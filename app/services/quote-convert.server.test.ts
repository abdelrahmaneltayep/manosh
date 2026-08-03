import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { convertQuoteToOrder, QuoteConvertError } from "./quote-convert.server";
import type { AdminGraphqlClient, DraftOrderInput } from "./draft-order.server";

const hasDb = Boolean(process.env.DATABASE_URL);

function fakeAdmin(capture: { input?: DraftOrderInput; sent?: boolean }): AdminGraphqlClient {
  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      if (query.includes("draftOrderCreate")) {
        capture.input = options?.variables?.input as DraftOrderInput;
        return { json: async () => ({ data: { draftOrderCreate: {
          draftOrder: { id: "gid://shopify/DraftOrder/5", subtotalPriceSet: { shopMoney: { amount: "230.00", currencyCode: "USD" } }, totalTaxSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } }, totalPriceSet: { shopMoney: { amount: "230.00", currencyCode: "USD" } } },
          userErrors: [],
        } } }) };
      }
      if (query.includes("draftOrderInvoiceSend")) {
        capture.sent = true;
        return { json: async () => ({ data: { draftOrderInvoiceSend: { draftOrder: { id: "gid://shopify/DraftOrder/5" }, userErrors: [] } } }) };
      }
      return { json: async () => ({ data: {} }) };
    },
  };
}

describe.skipIf(!hasDb)("quote-convert.server (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "QuoteLine","Quote","Buyer","Company","Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function acceptedQuote() {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "qc.myshopify.com", plan: "STARTER" } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/1", name: "Acme" } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "b@x.com", shopifyContactId: "gid://shopify/CompanyContact/1", shopifyCompanyLocationId: "gid://shopify/CompanyLocation/1" } });
    const quote = await prisma.quote.create({
      data: {
        companyId: company.id, buyerId: buyer.id, status: "ACCEPTED", expiresAt: new Date("2030-01-01"),
        lines: { create: [
          { variantId: "gid://shopify/ProductVariant/1", title: "Mug", quantity: 10, price: "9.5000" },
          { variantId: "gid://shopify/ProductVariant/2", title: "Lid", quantity: 27, price: "5.0000" },
        ] },
      },
    });
    return { shop, quote };
  }

  it("converts at the EXACT negotiated prices (never re-priced) + sends invoice + sets convertedOrderId", async () => {
    const { quote } = await acceptedQuote();
    const cap: { input?: DraftOrderInput; sent?: boolean } = {};
    const res = await convertQuoteToOrder(quote.id, fakeAdmin(cap), { currencyCode: "USD" });

    // Line prices must equal the quote's stored prices, verbatim — no live re-price.
    expect(cap.input?.lineItems).toEqual([
      { variantId: "gid://shopify/ProductVariant/1", quantity: 10, priceOverride: { amount: "9.5", currencyCode: "USD" } },
      { variantId: "gid://shopify/ProductVariant/2", quantity: 27, priceOverride: { amount: "5", currencyCode: "USD" } },
    ]);
    expect(cap.input?.purchasingEntity.purchasingCompany.companyId).toBe("gid://shopify/Company/1");
    expect(cap.sent).toBe(true);
    expect(res).toMatchObject({ orderId: "gid://shopify/DraftOrder/5", invoiceSent: true });

    const after = await prisma.quote.findUnique({ where: { id: quote.id }, select: { status: true, convertedOrderId: true, draftOrderId: true } });
    expect(after).toMatchObject({ status: "ORDERED", convertedOrderId: "gid://shopify/DraftOrder/5" });
    expect(await prisma.event.count({ where: { type: "QUOTE_CONVERTED" } })).toBe(1);
  });

  it("blocks a non-accepted or already-converted quote", async () => {
    const { quote } = await acceptedQuote();
    await convertQuoteToOrder(quote.id, fakeAdmin({}), { currencyCode: "USD" });
    await expect(convertQuoteToOrder(quote.id, fakeAdmin({}), { currencyCode: "USD" })).rejects.toBeInstanceOf(QuoteConvertError);
  });

  it("converts a COUNTERED quote (buyer agreed offline): COUNTERED → ACCEPTED → ORDERED", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "qc.myshopify.com", plan: "STARTER" } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/1", name: "Acme" } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "b@x.com", shopifyContactId: "gid://shopify/CompanyContact/1", shopifyCompanyLocationId: "gid://shopify/CompanyLocation/1" } });
    const quote = await prisma.quote.create({
      data: { companyId: company.id, buyerId: buyer.id, status: "COUNTERED", expiresAt: new Date("2030-01-01"),
        lines: { create: [{ variantId: "gid://shopify/ProductVariant/1", title: "Mug", quantity: 3, price: "9.5000" }] } },
    });
    const res = await convertQuoteToOrder(quote.id, fakeAdmin({}), { currencyCode: "USD" });
    expect(res.orderId).toBe("gid://shopify/DraftOrder/5");
    const after = await prisma.quote.findUnique({ where: { id: quote.id }, select: { status: true, convertedOrderId: true } });
    expect(after?.status).toBe("ORDERED");
    expect(after?.convertedOrderId).toBe("gid://shopify/DraftOrder/5");
  });

  it("skips the invoice when sendInvoice is false", async () => {
    const { quote } = await acceptedQuote();
    const cap: { input?: DraftOrderInput; sent?: boolean } = {};
    const res = await convertQuoteToOrder(quote.id, fakeAdmin(cap), { currencyCode: "USD", sendInvoice: false });
    expect(cap.sent).toBeUndefined();
    expect(res.invoiceSent).toBe(false);
  });
});
