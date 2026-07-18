import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { acceptAndOrder } from "./quote-accept.server";
import {
  DraftOrderError,
  type AdminGraphqlClient,
} from "./draft-order.server";
import { IllegalQuoteTransitionError, counterQuote, submitQuote } from "./quote.server";

const hasDb = Boolean(process.env.DATABASE_URL);

const totals = (id?: string) => ({
  ...(id ? { id } : {}),
  subtotalPriceSet: { shopMoney: { amount: "190.00", currencyCode: "USD" } },
  totalTaxSet: { shopMoney: { amount: "15.20", currencyCode: "USD" } },
  totalPriceSet: { shopMoney: { amount: "205.20", currencyCode: "USD" } },
});

function mockAdmin(options: {
  createUserErrors?: { message: string }[];
} = {}): AdminGraphqlClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    graphql: async (query) => {
      if (query.includes("draftOrderCalculate")) {
        calls.push("calculate");
        return {
          json: async () => ({
            data: { draftOrderCalculate: { calculatedDraftOrder: totals(), userErrors: [] } },
          }),
        };
      }
      calls.push("create");
      return {
        json: async () => ({
          data: {
            draftOrderCreate: {
              draftOrder: options.createUserErrors ? null : totals("gid://shopify/DraftOrder/500"),
              userErrors: options.createUserErrors ?? [],
            },
          },
        }),
      };
    },
  };
}

describe.skipIf(!hasDb)("acceptAndOrder (DB + mocked Admin API)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function counteredQuote(opts: { withLocation?: boolean } = {}) {
    const shop = await prisma.shop.create({
      data: { shopifyDomain: "s8.myshopify.com", quoteExpiryDays: 14 },
    });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/8", name: "Co" },
    });
    const buyer = await prisma.buyer.create({
      data: {
        companyId: company.id,
        email: "b@s8.example",
        shopifyContactId: "gid://shopify/CompanyContact/8",
        shopifyCompanyLocationId:
          opts.withLocation === false ? null : "gid://shopify/CompanyLocation/8",
      },
    });
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: [{ variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 10, price: "9.50" }],
    });
    await counterQuote(quote.id, { lines: [{ id: quote.lines[0].id, price: "9.00" }] });
    return { shop, company, buyer, quote };
  }

  it("creates a draft order, snapshots Shopify totals, and moves the quote to ORDERED", async () => {
    const { quote } = await counteredQuote();
    const admin = mockAdmin();

    const result = await acceptAndOrder(quote.id, admin, { currencyCode: "USD" });

    // Shopify was asked to price then create, in that order.
    expect(admin.calls).toEqual(["calculate", "create"]);

    expect(result.quote.status).toBe("ORDERED");
    expect(result.quote.draftOrderId).toBe("gid://shopify/DraftOrder/500");
    // Totals are Shopify's response, snapshotted verbatim (we compute nothing).
    expect(result.totals).toEqual({
      subtotal: "190.00",
      totalTax: "15.20",
      total: "205.20",
      currencyCode: "USD",
    });
    expect(result.quote.totalsSnapshot).toMatchObject({ total: "205.20" });

    const events = await prisma.event.findMany({
      where: { entityId: quote.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.type)).toEqual([
      "QUOTE_SUBMITTED",
      "QUOTE_COUNTERED",
      "QUOTE_ACCEPTED",
      "QUOTE_ORDERED",
      "DRAFT_ORDER_CREATED",
    ]);
  });

  it("refuses to accept a quote that isn't COUNTERED", async () => {
    const { quote } = await counteredQuote();
    const admin = mockAdmin();
    // Take it to ORDERED first, then try again.
    await acceptAndOrder(quote.id, admin, { currencyCode: "USD" });

    await expect(
      acceptAndOrder(quote.id, mockAdmin(), { currencyCode: "USD" }),
    ).rejects.toBeInstanceOf(IllegalQuoteTransitionError);
  });

  it("fails cleanly when the buyer has no company location (no Shopify call, no state change)", async () => {
    const { quote } = await counteredQuote({ withLocation: false });
    const admin = mockAdmin();

    await expect(
      acceptAndOrder(quote.id, admin, { currencyCode: "USD" }),
    ).rejects.toBeInstanceOf(DraftOrderError);

    expect(admin.calls).toEqual([]);
    const stored = await prisma.quote.findUnique({ where: { id: quote.id } });
    expect(stored!.status).toBe("COUNTERED");
  });

  it("leaves the quote COUNTERED when Shopify rejects the create", async () => {
    const { quote } = await counteredQuote();
    const admin = mockAdmin({ createUserErrors: [{ message: "Company location required" }] });

    await expect(
      acceptAndOrder(quote.id, admin, { currencyCode: "USD" }),
    ).rejects.toBeInstanceOf(DraftOrderError);

    const stored = await prisma.quote.findUnique({ where: { id: quote.id } });
    expect(stored!.status).toBe("COUNTERED");
    expect(stored!.draftOrderId).toBeNull();
    // No accepted/ordered/draft events were written.
    const types = (
      await prisma.event.findMany({ where: { entityId: quote.id } })
    ).map((e) => e.type);
    expect(types).not.toContain("QUOTE_ACCEPTED");
    expect(types).not.toContain("DRAFT_ORDER_CREATED");
  });
});
