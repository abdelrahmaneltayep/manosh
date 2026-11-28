import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { sendQuoteForShop, saveInternalNote } from "./quote-send.server";
import { NO_ADJUSTMENTS, type QuoteAdjustments } from "../lib/quote-adjustments";
import type { AdminGraphqlClient } from "./draft-order.server";

// Phase 3: Send quote recalculates with Shopify first; nothing is saved or
// sent if Shopify can't. Shopify's Admin API is mocked.
const hasDb = Boolean(process.env.DATABASE_URL);
const DOMAIN = "send.myshopify.com";
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" }, presentmentMoney: { amount, currencyCode: "USD" } });

function shopify(mode: "ok" | "down" | "refuses" = "ok") {
  const inputs: Record<string, unknown>[] = [];
  const admin: AdminGraphqlClient = {
    graphql: async (_query, options) => {
      inputs.push(options?.variables?.input as Record<string, unknown>);
      if (mode === "down") throw new Error("fetch failed");
      const payload =
        mode === "refuses"
          ? { calculatedDraftOrder: null, userErrors: [{ field: ["lineItems"], message: "Variant is unavailable" }] }
          : {
              calculatedDraftOrder: {
                subtotalPriceSet: money("228.00"),
                totalTaxSet: money("22.80"),
                totalPriceSet: money("265.80"),
                totalDiscountsSet: money("22.80"),
                totalShippingPriceSet: money("15.00"),
              },
              userErrors: [],
            };
      return { json: async () => ({ data: { draftOrderCalculate: payload } }) };
    },
  };
  return { admin, inputs };
}

async function seed(opts: { expired?: boolean; price?: string } = {}) {
  const shop = await prisma.shop.create({ data: { shopifyDomain: DOMAIN } });
  const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/9", name: "Send Co." } });
  const buyer = await prisma.buyer.create({
    data: { companyId: company.id, email: "s@buyer.example", shopifyContactId: "gid://shopify/CompanyContact/9", shopifyCompanyLocationId: "gid://shopify/CompanyLocation/9" },
  });
  const quote = await prisma.quote.create({
    data: {
      companyId: company.id,
      buyerId: buyer.id,
      expiresAt: new Date(Date.now() + (opts.expired ? -1 : 1) * 86_400_000),
      lines: { create: [{ variantId: "gid://shopify/ProductVariant/1", title: "Mug", quantity: 24, price: opts.price ?? "9.50" }] },
    },
    include: { lines: true },
  });
  return { shop, quote };
}

const ADJ: QuoteAdjustments = {
  discount: { valueType: "PERCENTAGE", value: "10", title: "Volume" },
  shipping: { title: "Freight", price: "15" },
  customItems: [{ title: "Setup fee", quantity: 1, price: "50" }],
};

describe.skipIf(!hasDb)("Send quote", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("asks Shopify to price exactly what is sent, then saves Shopify's totals", async () => {
    const { quote } = await seed();
    const { admin, inputs } = shopify();
    const res = await sendQuoteForShop({
      shopDomain: DOMAIN, quoteId: quote.id, admin, currencyCode: "USD",
      lines: [{ id: quote.lines[0].id, price: "9.00" }], adjustments: ADJ, buyerMessage: "Thanks for the order!",
    });
    expect(res).toMatchObject({ ok: true, totals: { total: "265.80", totalDiscounts: "22.80", totalShipping: "15.00" } });
    const input = inputs[0] as { lineItems: unknown[]; appliedDiscount: unknown; shippingLine: unknown };
    expect(input.lineItems).toEqual([
      { variantId: "gid://shopify/ProductVariant/1", quantity: 24, priceOverride: { amount: "9.00", currencyCode: "USD" } },
      { title: "Setup fee", quantity: 1, originalUnitPriceWithCurrency: { amount: "50", currencyCode: "USD" } },
    ]);
    expect(input.appliedDiscount).toEqual({ valueType: "PERCENTAGE", value: 10, title: "Volume" });
    expect(input.shippingLine).toEqual({ title: "Freight", priceWithCurrency: { amount: "15", currencyCode: "USD" } });
    const saved = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: true } });
    expect(saved.status).toBe("COUNTERED");
    expect(saved.lines[0].price.toString()).toBe("9");
    expect((saved.totalsSnapshot as { total: string }).total).toBe("265.80");
    expect(saved.adjustments).toEqual(ADJ);
    expect(saved.buyerMessage).toBe("Thanks for the order!");
  });

  it.each([
    ["Shopify is unreachable", "down", /couldn’t be reached/],
    ["Shopify refuses the order", "refuses", /Variant is unavailable/],
  ] as const)("when %s nothing is saved or sent", async (_label, mode, message) => {
    const { quote } = await seed();
    const res = await sendQuoteForShop({ shopDomain: DOMAIN, quoteId: quote.id, admin: shopify(mode).admin, currencyCode: "USD", lines: [{ id: quote.lines[0].id, price: "8.00" }], adjustments: ADJ, buyerMessage: null });
    expect(res).toMatchObject({ ok: false, reason: "shopify", error: expect.stringMatching(message) });
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: true } });
    expect([after.status, after.lines[0].price.toString(), after.totalsSnapshot, after.adjustments]).toEqual(["SUBMITTED", "9.5", null, null]);
  });

  it("blocks a zero or negative price before asking Shopify", async () => {
    const { quote } = await seed({ price: "0" });
    const { admin, inputs } = shopify();
    const res = await sendQuoteForShop({ shopDomain: DOMAIN, quoteId: quote.id, admin, currencyCode: "USD", lines: [], adjustments: NO_ADJUSTMENTS, buyerMessage: null });
    expect(res).toMatchObject({ ok: false, reason: "price", error: "Set a price above 0 for “Mug” before sending." });
    expect(inputs).toHaveLength(0);
  });

  it("can't send an expired quote", async () => {
    const { quote } = await seed({ expired: true });
    const res = await sendQuoteForShop({ shopDomain: DOMAIN, quoteId: quote.id, admin: shopify().admin, currencyCode: "USD", lines: [], adjustments: NO_ADJUSTMENTS, buyerMessage: null });
    expect(res).toMatchObject({ ok: false, reason: "blocked", error: expect.stringMatching(/expired/) });
  });

  it("another store can't send or annotate this quote", async () => {
    const { quote } = await seed();
    const res = await sendQuoteForShop({ shopDomain: "other.myshopify.com", quoteId: quote.id, admin: shopify().admin, currencyCode: "USD", lines: [], adjustments: NO_ADJUSTMENTS, buyerMessage: null });
    expect(res).toMatchObject({ ok: false, reason: "not-found" });
    expect(await saveInternalNote("other.myshopify.com", quote.id, "hi")).toBe(false);
    expect(await saveInternalNote(DOMAIN, quote.id, "  Call before shipping  ")).toBe(true);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).internalNote).toBe("Call before shipping");
  });
});
