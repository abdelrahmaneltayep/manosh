import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import type { CatalogItem } from "./catalog.server";
import type { AdminGraphqlClient } from "./draft-order.server";
import {
  buildReorderLines,
  createReorder,
  listReorderCards,
  mapOrderLines,
  reorderNeedsApproval,
  type ReorderLine,
} from "./reorder.server";

const hasDb = Boolean(process.env.DATABASE_URL);

const CATALOG: CatalogItem[] = [
  { variantId: "gid://v/1", productId: "gid://shopify/Product/gid://v/1", productTitle: "Widget", variantTitle: null, displayTitle: "Widget", sku: "A-1", price: "9.50", currencyCode: "USD" },
  { variantId: "gid://v/2", productId: "gid://shopify/Product/gid://v/2", productTitle: "Gadget", variantTitle: null, displayTitle: "Gadget", sku: "B-2", price: "22.00", currencyCode: "USD" },
];

describe("mapOrderLines (pure)", () => {
  it("maps variant lines and skips custom/deleted lines", () => {
    const lines = mapOrderLines({
      order: {
        lineItems: {
          nodes: [
            { quantity: 3, name: "Widget", sku: "A-1", variant: { id: "gid://v/1" }, originalUnitPriceSet: { shopMoney: { amount: "9.00" } } },
            { quantity: 1, name: "Custom", sku: null, variant: null, originalUnitPriceSet: { shopMoney: { amount: "5.00" } } },
          ],
        },
      },
    });
    expect(lines).toEqual([
      { variantId: "gid://v/1", quantity: 3, price: "9.00", title: "Widget", sku: "A-1" },
    ]);
  });
});

describe("buildReorderLines (pure)", () => {
  it("resolves current prices and flags unavailable variants", () => {
    const { lines, unavailable } = buildReorderLines(
      [
        { variantId: "gid://v/1", quantity: 3, price: "9.00", title: "Widget", sku: "A-1" },
        { variantId: "gid://v/gone", quantity: 1, price: "1.00", title: "Old", sku: "X" },
      ],
      CATALOG,
    );
    expect(lines).toEqual([
      { variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 3, originalPrice: "9.00", currentPrice: "9.50" },
    ]);
    expect(unavailable).toHaveLength(1);
  });
});

describe("reorderNeedsApproval (pure)", () => {
  const line = (originalPrice: string, currentPrice: string) => ({ originalPrice, currentPrice });

  it("needs approval when any price moves beyond tolerance", () => {
    // 9.00 -> 9.50 is ~5.6% > 5% tolerance.
    expect(reorderNeedsApproval([line("9.00", "9.50")], 0.05)).toBe(true);
  });

  it("auto-approves when all prices are within tolerance", () => {
    expect(reorderNeedsApproval([line("9.00", "9.20")], 0.05)).toBe(false);
    expect(reorderNeedsApproval([line("9.00", "9.00")], 0)).toBe(false);
  });

  it("tolerance 0 means any change needs approval", () => {
    expect(reorderNeedsApproval([line("9.00", "9.01")], 0)).toBe(true);
  });
});

describe.skipIf(!hasDb)("createReorder + listReorderCards (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","ReorderSource","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup(tolerance = 0.05) {
    const shop = await prisma.shop.create({
      data: { shopifyDomain: "s9.myshopify.com", autoApproveTolerance: tolerance },
    });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/9", name: "Co" },
    });
    const buyer = await prisma.buyer.create({
      data: {
        companyId: company.id,
        email: "b@s9.example",
        shopifyContactId: "gid://shopify/CompanyContact/9",
        shopifyCompanyLocationId: "gid://shopify/CompanyLocation/9",
      },
    });
    await prisma.reorderSource.create({
      data: {
        companyId: company.id,
        shopifyOrderId: "gid://shopify/Order/1001",
        orderName: "#1001",
        orderedAt: new Date("2026-06-01T00:00:00Z"),
        total: "500.00",
        currency: "USD",
      },
    });
    return { shop, company, buyer };
  }

  const mockAdmin = (): AdminGraphqlClient => ({
    graphql: async (query) => {
      const totals = {
        subtotalPriceSet: { shopMoney: { amount: "28.50", currencyCode: "USD" } },
        totalTaxSet: { shopMoney: { amount: "2.28", currencyCode: "USD" } },
        totalPriceSet: { shopMoney: { amount: "30.78", currencyCode: "USD" } },
      };
      const data = query.includes("draftOrderCalculate")
        ? { draftOrderCalculate: { calculatedDraftOrder: totals, userErrors: [] } }
        : { draftOrderCreate: { draftOrder: { id: "gid://shopify/DraftOrder/900", ...totals }, userErrors: [] } };
      return { json: async () => ({ data }) };
    },
  });

  const withinLines: ReorderLine[] = [
    { variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 3, originalPrice: "9.50", currentPrice: "9.50" },
  ];
  const movedLines: ReorderLine[] = [
    { variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 3, originalPrice: "9.00", currentPrice: "11.00" },
  ];

  it("lists a company's reorder cards", async () => {
    const { company } = await setup();
    const cards = await listReorderCards(company.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].orderName).toBe("#1001");
  });

  it("auto-converts a reorder within tolerance to a draft order", async () => {
    const { company, buyer } = await setup(0.05);
    const result = await createReorder({
      companyId: company.id,
      buyerId: buyer.id,
      lines: withinLines,
      tolerance: 0.05,
      autoConvert: { admin: mockAdmin(), currencyCode: "USD" },
    });

    expect(result.autoApproved).toBe(true);
    expect(result.quote.status).toBe("ORDERED");
    expect(result.quote.draftOrderId).toBe("gid://shopify/DraftOrder/900");

    const types = (
      await prisma.event.findMany({ where: { entityId: result.quote.id }, orderBy: { createdAt: "asc" } })
    ).map((e) => e.type);
    expect(types).toContain("REORDER_CREATED");
    expect(types).toContain("DRAFT_ORDER_CREATED");
    expect(types.at(-1)).toBe("DRAFT_ORDER_CREATED");
  });

  it("leaves a reorder outside tolerance as a SUBMITTED quote for approval", async () => {
    const { company, buyer } = await setup(0.05);
    const result = await createReorder({
      companyId: company.id,
      buyerId: buyer.id,
      lines: movedLines,
      tolerance: 0.05,
      autoConvert: { admin: mockAdmin(), currencyCode: "USD" },
    });

    expect(result.autoApproved).toBe(false);
    expect(result.needsApproval).toBe(true);
    expect(result.quote.status).toBe("SUBMITTED");
    expect(result.quote.draftOrderId).toBeNull();

    const types = (
      await prisma.event.findMany({ where: { entityId: result.quote.id } })
    ).map((e) => e.type);
    expect(types).toContain("REORDER_CREATED");
    expect(types).not.toContain("DRAFT_ORDER_CREATED");
  });
});
