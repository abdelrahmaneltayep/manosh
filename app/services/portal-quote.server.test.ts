import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import type { CatalogItem } from "./catalog.server";
import {
  buildQuoteLinesFromSelections,
  parseQuoteSelections,
  submitBuyerQuote,
} from "./portal-quote.server";

const hasDb = Boolean(process.env.DATABASE_URL);

const CATALOG: CatalogItem[] = [
  { variantId: "gid://v/1", productId: "gid://shopify/Product/gid://v/1", productTitle: "Widget", variantTitle: null, displayTitle: "Widget", sku: "A-1", price: "9.50", currencyCode: "USD" },
  { variantId: "gid://v/2", productId: "gid://shopify/Product/gid://v/2", productTitle: "Gadget", variantTitle: "Blue", displayTitle: "Gadget — Blue", sku: "B-2", price: "20.00", currencyCode: "USD" },
];

function formData(entries: [string, string][]): FormData {
  const form = new FormData();
  for (const [k, v] of entries) form.append(k, v);
  return form;
}

describe("parseQuoteSelections (pure)", () => {
  it("collects quantity_<variantId> fields with qty > 0", () => {
    const selections = parseQuoteSelections(
      formData([
        ["quantity_gid://v/1", "3"],
        ["quantity_gid://v/2", "0"],
        ["other", "x"],
      ]),
    );
    expect(selections).toEqual([{ variantId: "gid://v/1", quantity: 3 }]);
  });
});

describe("buildQuoteLinesFromSelections (pure)", () => {
  it("resolves line details from the catalog (not the client)", () => {
    const result = buildQuoteLinesFromSelections(CATALOG, [
      { variantId: "gid://v/2", quantity: 5 },
    ]);
    expect(result).toEqual({
      ok: true,
      lines: [
        { variantId: "gid://v/2", sku: "B-2", title: "Gadget — Blue", quantity: 5, price: "20.00" },
      ],
    });
  });

  it("rejects an empty basket", () => {
    expect(buildQuoteLinesFromSelections(CATALOG, []).ok).toBe(false);
  });

  it("rejects a variant not in the catalog", () => {
    const result = buildQuoteLinesFromSelections(CATALOG, [
      { variantId: "gid://v/999", quantity: 1 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-positive quantity", () => {
    expect(
      buildQuoteLinesFromSelections(CATALOG, [{ variantId: "gid://v/1", quantity: 0 }]).ok,
    ).toBe(false);
  });
});

describe.skipIf(!hasDb)("submitBuyerQuote (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function makeBuyer() {
    const shop = await prisma.shop.create({
      data: { shopifyDomain: "s7.myshopify.com", quoteExpiryDays: 14 },
    });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: "gid://c/1", name: "Co" },
    });
    const buyer = await prisma.buyer.create({
      data: { companyId: company.id, email: "b@s7.example" },
    });
    return { company, buyer };
  }

  it("creates a SUBMITTED quote with resolved lines and an event", async () => {
    const { company, buyer } = await makeBuyer();
    const result = await submitBuyerQuote(
      { id: buyer.id, companyId: company.id },
      [
        { variantId: "gid://v/1", quantity: 4 },
        { variantId: "gid://v/2", quantity: 2 },
      ],
      CATALOG,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.status).toBe("SUBMITTED");
    expect(result.quote.lines).toHaveLength(2);
    const widget = result.quote.lines.find((l) => l.sku === "A-1")!;
    expect(widget.quantity).toBe(4);
    expect(Number(widget.price)).toBe(9.5);

    const events = await prisma.event.count({
      where: { entityId: result.quote.id, type: "QUOTE_SUBMITTED" },
    });
    expect(events).toBe(1);
  });

  it("does not create a quote for an invalid basket", async () => {
    const { company, buyer } = await makeBuyer();
    const result = await submitBuyerQuote(
      { id: buyer.id, companyId: company.id },
      [{ variantId: "gid://v/nope", quantity: 1 }],
      CATALOG,
    );
    expect(result.ok).toBe(false);
    expect(await prisma.quote.count()).toBe(0);
  });
});
