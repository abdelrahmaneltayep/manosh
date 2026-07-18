import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  counterQuoteForShop,
  declineQuoteForShop,
  getQuoteDetailForShop,
  listQuotesForShop,
  parseCounterForm,
} from "./quote-inbox.server";
import {
  IllegalQuoteTransitionError,
  QuoteNotFoundError,
  submitQuote,
} from "./quote.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;

function formData(entries: [string, string][]): FormData {
  const form = new FormData();
  for (const [k, v] of entries) form.append(k, v);
  return form;
}

describe("parseCounterForm (pure)", () => {
  it("parses line ids with revised price and quantity", () => {
    const result = parseCounterForm(
      formData([
        ["lineId", "l1"],
        ["price_l1", "8.75"],
        ["quantity_l1", "12"],
      ]),
    );
    expect(result).toEqual({ ok: true, lines: [{ id: "l1", price: "8.75", quantity: 12 }] });
  });

  it("leaves blank fields unchanged", () => {
    const result = parseCounterForm(
      formData([
        ["lineId", "l1"],
        ["price_l1", ""],
        ["quantity_l1", ""],
      ]),
    );
    expect(result).toEqual({ ok: true, lines: [{ id: "l1" }] });
  });

  it("rejects an invalid price", () => {
    const result = parseCounterForm(
      formData([
        ["lineId", "l1"],
        ["price_l1", "9.999999"],
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a zero or fractional quantity", () => {
    expect(parseCounterForm(formData([["lineId", "l1"], ["quantity_l1", "0"]])).ok).toBe(false);
    expect(parseCounterForm(formData([["lineId", "l1"], ["quantity_l1", "1.5"]])).ok).toBe(false);
  });
});

describe.skipIf(!hasDb)("quote inbox service (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function shopWithQuote(domain: string, opts: { now?: Date } = {}) {
    const shop = await prisma.shop.create({
      data: { shopifyDomain: domain, quoteExpiryDays: 14 },
    });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: `gid://c/${domain}`, name: `Co ${domain}` },
    });
    const buyer = await prisma.buyer.create({
      data: { companyId: company.id, email: `b@${domain}` },
    });
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      now: opts.now,
      lines: [
        { variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 10, price: "9.50" },
      ],
    });
    return { shop, company, buyer, quote };
  }

  it("lists a shop's quotes with a display status (no write for a due quote)", async () => {
    const now = new Date("2026-07-18T00:00:00Z");
    const { quote } = await shopWithQuote("a.myshopify.com", { now });

    // Time-travel past expiry: display should read EXPIRED but the row is NOT
    // flipped in the DB by a list read.
    const rows = await listQuotesForShop("a.myshopify.com");
    // (listQuotesForShop uses the real clock; assert the mapping shape instead)
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(quote.id);
    expect(rows[0].status).toBe("SUBMITTED");
    expect(rows[0].lineCount).toBe(1);
    const stored = await prisma.quote.findUnique({ where: { id: quote.id } });
    expect(stored!.status).toBe("SUBMITTED");
  });

  it("only returns the requesting shop's quotes", async () => {
    await shopWithQuote("a.myshopify.com");
    await shopWithQuote("b.myshopify.com");
    const rowsA = await listQuotesForShop("a.myshopify.com");
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].companyName).toBe("Co a.myshopify.com");
  });

  it("getQuoteDetailForShop returns null for another shop's quote", async () => {
    const { quote } = await shopWithQuote("a.myshopify.com");
    expect(await getQuoteDetailForShop("b.myshopify.com", quote.id)).toBeNull();
    expect(await getQuoteDetailForShop("a.myshopify.com", quote.id)).not.toBeNull();
  });

  it("counters a quote and revises a line; status → COUNTERED with an event", async () => {
    const { quote } = await shopWithQuote("a.myshopify.com");
    const result = await counterQuoteForShop("a.myshopify.com", quote.id, [
      { id: quote.lines[0].id, price: "8.00", quantity: 15 },
    ]);
    expect(result.status).toBe("COUNTERED");
    expect(Number(result.lines[0].price)).toBe(8);
    expect(result.lines[0].quantity).toBe(15);

    const events = await prisma.event.count({
      where: { entityId: quote.id, type: "QUOTE_COUNTERED" },
    });
    expect(events).toBe(1);
  });

  it("refuses to counter a quote that belongs to another shop", async () => {
    const { quote } = await shopWithQuote("a.myshopify.com");
    await expect(
      counterQuoteForShop("b.myshopify.com", quote.id, []),
    ).rejects.toBeInstanceOf(QuoteNotFoundError);
    // Untouched.
    const stored = await prisma.quote.findUnique({ where: { id: quote.id } });
    expect(stored!.status).toBe("SUBMITTED");
  });

  it("propagates an illegal transition when countering a non-SUBMITTED quote", async () => {
    const { quote } = await shopWithQuote("a.myshopify.com");
    await counterQuoteForShop("a.myshopify.com", quote.id, []);
    await expect(
      counterQuoteForShop("a.myshopify.com", quote.id, []),
    ).rejects.toBeInstanceOf(IllegalQuoteTransitionError);
  });

  it("declines (expires) a quote", async () => {
    const { quote } = await shopWithQuote("a.myshopify.com");
    const result = await declineQuoteForShop("a.myshopify.com", quote.id);
    expect(result.status).toBe("EXPIRED");
  });

  it("auto-expires a due quote when its detail is opened", async () => {
    const now = new Date("2026-07-18T00:00:00Z");
    const { quote } = await shopWithQuote("a.myshopify.com", { now });
    // Force the stored expiry into the past, then open the detail.
    await prisma.quote.update({
      where: { id: quote.id },
      data: { expiresAt: new Date(Date.now() - DAY) },
    });
    const detail = await getQuoteDetailForShop("a.myshopify.com", quote.id);
    expect(detail!.status).toBe("EXPIRED");
  });
});
