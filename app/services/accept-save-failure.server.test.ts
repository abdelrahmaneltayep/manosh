import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3 review: Shopify created the draft order, Mannon's save failed, then
// the buyer retries. The retry finds the draft by its quote tag: one order.
let failSaves = 0;
vi.mock("./quote.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("./quote.server")>();
  return {
    ...real,
    markOrdered: async (...args: Parameters<typeof real.markOrdered>) => {
      if (failSaves > 0) {
        failSaves--;
        throw new Error("connection to the database was lost");
      }
      return real.markOrdered(...args);
    },
  };
});

const { default: prisma } = await import("../db.server");
const { acceptAndOrder } = await import("./quote-accept.server");
const { counterQuote, submitQuote } = await import("./quote.server");
import type { AdminGraphqlClient } from "./draft-order.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const totals = { subtotalPriceSet: money("90.00"), totalTaxSet: money("9.00"), totalPriceSet: money("99.00") };

function shopify() {
  const byTag = new Map<string, string>();
  const created: string[] = [];
  const admin: AdminGraphqlClient = {
    graphql: async (query, options) => {
      if (query.includes("MannonDraftOrderByTag")) {
        const tag = /tag:'([^']+)'/.exec(String(options?.variables?.query))?.[1] ?? "";
        const id = byTag.get(tag);
        return { json: async () => ({ data: { draftOrders: { nodes: id ? [{ id, ...totals }] : [] } } }) };
      }
      if (query.includes("draftOrderCalculate")) {
        return { json: async () => ({ data: { draftOrderCalculate: { calculatedDraftOrder: totals, userErrors: [] } } }) };
      }
      const id = `gid://shopify/DraftOrder/${900 + created.length}`;
      created.push(id);
      for (const tag of (options?.variables?.input as { tags?: string[] })?.tags ?? []) byTag.set(tag, id);
      return { json: async () => ({ data: { draftOrderCreate: { draftOrder: { id, ...totals }, userErrors: [] } } }) };
    },
  };
  return { admin, created };
}

describe.skipIf(!hasDb)("accept after a failed save", () => {
  beforeEach(async () => {
    failSaves = 0;
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Shopify created it, our save failed, the retry reuses the same draft order", async () => {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "save.myshopify.com" } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/41", name: "Save Co." } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "s@save.example", shopifyContactId: "gid://shopify/CompanyContact/41", shopifyCompanyLocationId: "gid://shopify/CompanyLocation/41" } });
    const quote = await submitQuote({ companyId: company.id, buyerId: buyer.id, lines: [{ variantId: "gid://v/1", title: "W", quantity: 10, price: "9.00" }] });
    await counterQuote(quote.id);
    const { admin, created } = shopify();

    failSaves = 1;
    await expect(acceptAndOrder(quote.id, admin, { currencyCode: "USD" })).rejects.toThrow(/database was lost/);
    expect(created).toHaveLength(1);
    const between = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect([between.draftOrderId, between.orderingSince]).toEqual([null, null]); // claim released, nothing saved

    const done = await acceptAndOrder(quote.id, admin, { currencyCode: "USD" });
    expect(created).toHaveLength(1); // no second draft order
    expect(done.quote.status).toBe("ORDERED");
    expect(done.quote.draftOrderId).toBe(created[0]);
  });
});
