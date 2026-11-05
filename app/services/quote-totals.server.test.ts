import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { previewQuoteTotals, readSnapshot } from "./quote-totals.server";
import type { AdminGraphqlClient } from "./draft-order.server";
import { submitQuote } from "./quote.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("readSnapshot (pure)", () => {
  it("reads a complete Shopify snapshot", () => {
    expect(readSnapshot({ subtotal: "190.00", totalTax: "15.20", total: "205.20", currencyCode: "CAD" })).toEqual({
      subtotal: "190.00",
      totalTax: "15.20",
      total: "205.20",
      currencyCode: "CAD",
    });
  });

  it("is null for a missing or partial snapshot (never fills in money)", () => {
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot({ subtotal: "1.00", total: "1.00" })).toBeNull();
    expect(readSnapshot("205.20")).toBeNull();
  });
});

describe.skipIf(!hasDb)("previewQuoteTotals (DB + mocked Admin API)", () => {
  const SHOP = "tc2.myshopify.com";

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup(opts: { linked?: boolean } = {}) {
    const shop = await prisma.shop.create({ data: { shopifyDomain: SHOP } });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/2", name: "Co" },
    });
    const buyer = await prisma.buyer.create({
      data: {
        companyId: company.id,
        email: "b@tc2.example",
        shopifyContactId: opts.linked === false ? null : "gid://shopify/CompanyContact/2",
        shopifyCompanyLocationId: opts.linked === false ? null : "gid://shopify/CompanyLocation/2",
      },
    });
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: [{ variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 10, price: "9.50" }],
    });
    return { quote };
  }

  function admin(response: unknown) {
    const inputs: Array<Record<string, unknown>> = [];
    const client: AdminGraphqlClient = {
      graphql: async (_q, options) => {
        inputs.push(options?.variables?.input as Record<string, unknown>);
        return { json: async () => response };
      },
    };
    return { client, inputs };
  }
  const calculated = {
    data: {
      draftOrderCalculate: {
        calculatedDraftOrder: {
          subtotalPriceSet: { presentmentMoney: { amount: "95.00", currencyCode: "USD" } },
          totalTaxSet: { presentmentMoney: { amount: "7.60", currencyCode: "USD" } },
          totalPriceSet: { presentmentMoney: { amount: "102.60", currencyCode: "USD" } },
        },
        userErrors: [],
      },
    },
  };

  it("prices the stored lines with Shopify", async () => {
    const { quote } = await setup();
    const { client, inputs } = admin(calculated);
    const r = await previewQuoteTotals({ shopDomain: SHOP, quoteId: quote.id, admin: client, currencyCode: "USD" });
    expect(r).toEqual({
      ok: true,
      source: "calculated",
      totals: { subtotal: "95.00", totalTax: "7.60", total: "102.60", currencyCode: "USD" },
    });
    expect((inputs[0].lineItems as Array<Record<string, unknown>>)[0]).toMatchObject({
      quantity: 10,
      priceOverride: { amount: "9.5", currencyCode: "USD" },
    });
  });

  it("prices unsaved counter edits without saving them", async () => {
    const { quote } = await setup();
    const { client, inputs } = admin(calculated);
    const lineId = quote.lines[0].id;
    await previewQuoteTotals({
      shopDomain: SHOP,
      quoteId: quote.id,
      admin: client,
      currencyCode: "USD",
      edits: [{ id: lineId, price: "8.75", quantity: 12 }],
    });
    expect((inputs[0].lineItems as Array<Record<string, unknown>>)[0]).toMatchObject({
      quantity: 12,
      priceOverride: { amount: "8.75" },
    });
    const stored = await prisma.quoteLine.findUnique({ where: { id: lineId } });
    expect(stored!.quantity).toBe(10);
  });

  it("shows the stored snapshot for an ordered quote, with no Shopify call", async () => {
    const { quote } = await setup();
    await prisma.quote.update({
      where: { id: quote.id },
      data: { status: "ORDERED", totalsSnapshot: { subtotal: "90.00", totalTax: "0.00", total: "90.00", currencyCode: "USD" } },
    });
    const { client, inputs } = admin(calculated);
    const r = await previewQuoteTotals({ shopDomain: SHOP, quoteId: quote.id, admin: client, currencyCode: "USD" });
    expect(r).toMatchObject({ ok: true, source: "snapshot", totals: { total: "90.00" } });
    expect(inputs).toHaveLength(0);
  });

  it("explains, in plain language, what to set up when Shopify has no company contact for the buyer", async () => {
    const { quote } = await setup({ linked: false });
    const { client, inputs } = admin({ data: { customers: { nodes: [] } } });
    const r = await previewQuoteTotals({ shopDomain: SHOP, quoteId: quote.id, admin: client, currencyCode: "USD" });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.message).toMatch(/Shopify can’t price this quote yet\. .*Customers → Companies/);
    expect(inputs.filter((i) => i && "input" in i)).toHaveLength(0);
  });

  it("turns a Shopify userError into a plain message", async () => {
    const { quote } = await setup();
    const { client } = admin({
      data: { draftOrderCalculate: { calculatedDraftOrder: null, userErrors: [{ field: null, message: "Variant is unavailable" }] } },
    });
    const r = await previewQuoteTotals({ shopDomain: SHOP, quoteId: quote.id, admin: client, currencyCode: "USD" });
    expect(r).toEqual({ ok: false, message: "Shopify couldn’t price this quote: Variant is unavailable" });
  });

  it("never reads another shop's quote", async () => {
    const { quote } = await setup();
    const { client } = admin(calculated);
    const r = await previewQuoteTotals({ shopDomain: "other.myshopify.com", quoteId: quote.id, admin: client, currencyCode: "USD" });
    expect(r).toEqual({ ok: false, message: "This quote couldn’t be found." });
  });
});
