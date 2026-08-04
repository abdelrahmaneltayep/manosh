import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { previewImport, commitImport, ImportHasErrorsError, type CatalogLoader } from "./quote-import.server";
import type { CatalogItem } from "./catalog.server";

const hasDb = Boolean(process.env.DATABASE_URL);

const CATALOG: CatalogItem[] = [
  { variantId: "gid://shopify/ProductVariant/1", productId: "gid://p/1", productTitle: "Mug", variantTitle: null, displayTitle: "Mug", sku: "MUG", price: "9.50", currencyCode: "USD" },
  { variantId: "gid://shopify/ProductVariant/2", productId: "gid://p/2", productTitle: "Lid", variantTitle: null, displayTitle: "Lid", sku: "LID", price: "5.00", currencyCode: "USD" },
];
const loadCatalog: CatalogLoader = async () => CATALOG;

describe.skipIf(!hasDb)("quote-import.server (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "QuoteLine","Quote","Buyer","Company","Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function shopWithBuyer() {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "qi.myshopify.com", plan: "GROWTH", quoteExpiryDays: 14 } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/1", name: "Acme" } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "buyer@acme.com" } });
    return { shop, company, buyer };
  }

  it("quotes mode: creates one quote per group with source IMPORT (all-or-nothing)", async () => {
    await shopWithBuyer();
    const csv = "quote,email,sku,quantity,price\nA,buyer@acme.com,MUG,10,\nA,buyer@acme.com,LID,5,4.50\nB,buyer@acme.com,MUG,2,\n";
    const preview = await previewImport("qi.myshopify.com", csv, "quotes", { plan: "GROWTH", loadCatalog });
    expect(preview.ok).toBe(true);
    expect(preview.quoteCount).toBe(2);
    expect(preview.rows[0].title).toBe("Mug");

    const res = await commitImport("qi.myshopify.com", csv, "quotes", { plan: "GROWTH", loadCatalog, now: new Date("2026-08-01T00:00:00Z") });
    expect(res.createdQuotes).toBe(2);
    const quotes = await prisma.quote.findMany({ include: { lines: true }, orderBy: { createdAt: "asc" } });
    expect(quotes).toHaveLength(2);
    expect(quotes.every((q) => q.source === "IMPORT" && q.status === "SUBMITTED")).toBe(true);
    // Group A has 2 lines; empty price falls back to the catalog reference (9.50).
    const a = quotes.find((q) => q.lines.length === 2)!;
    expect(a.lines.find((l) => l.sku === "MUG")!.price.toString()).toBe("9.5");
    expect(a.lines.find((l) => l.sku === "LID")!.price.toString()).toBe("4.5"); // CSV override
    expect(await prisma.event.count({ where: { type: "QUOTE_IMPORTED" } })).toBe(1);
  });

  it("refuses the whole batch when a row is invalid — nothing is written", async () => {
    await shopWithBuyer();
    const csv = "quote,email,sku,quantity,price\nA,buyer@acme.com,MUG,10,\nA,buyer@acme.com,NOPE,5,\n";
    const preview = await previewImport("qi.myshopify.com", csv, "quotes", { plan: "GROWTH", loadCatalog });
    expect(preview.ok).toBe(false);
    expect(preview.errors.some((e) => /not found/.test(e.message))).toBe(true);
    await expect(commitImport("qi.myshopify.com", csv, "quotes", { plan: "GROWTH", loadCatalog })).rejects.toBeInstanceOf(ImportHasErrorsError);
    expect(await prisma.quote.count()).toBe(0); // all-or-nothing
  });

  it("lines mode: adds rows to an editable target quote", async () => {
    const { company, buyer } = await shopWithBuyer();
    const quote = await prisma.quote.create({ data: { companyId: company.id, buyerId: buyer.id, status: "SUBMITTED", expiresAt: new Date("2030-01-01") } });
    const csv = "sku,quantity,price\nMUG,3,\nLID,4,4.00\n";
    const res = await commitImport("qi.myshopify.com", csv, "lines", { plan: "GROWTH", targetQuoteId: quote.id, loadCatalog });
    expect(res.addedLines).toBe(2);
    const lines = await prisma.quoteLine.findMany({ where: { quoteId: quote.id } });
    expect(lines).toHaveLength(2);
  });

  it("enforces the row cap", async () => {
    await shopWithBuyer();
    const many = ["quote,email,sku,quantity,price", ...Array.from({ length: 201 }, (_, i) => `Q${i},buyer@acme.com,MUG,1,`)].join("\n");
    const preview = await previewImport("qi.myshopify.com", many, "quotes", { plan: "GROWTH", loadCatalog });
    expect(preview.ok).toBe(false);
    expect(preview.errors.some((e) => /limit is 200/.test(e.message))).toBe(true);
  });
});
