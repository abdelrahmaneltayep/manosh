import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  IllegalQuoteTransitionError,
  acceptQuote,
  counterQuote,
  expireQuote,
  expireQuotesDue,
  getQuote,
  markOrdered,
  submitQuote,
} from "./quote.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;

async function makeCompanyBuyer(quoteExpiryDays = 14) {
  const shop = await prisma.shop.create({
    data: { shopifyDomain: "quote-test.myshopify.com", quoteExpiryDays },
  });
  const company = await prisma.company.create({
    data: {
      shopId: shop.id,
      shopifyCompanyId: "gid://shopify/Company/q",
      name: "Quote Co.",
    },
  });
  const buyer = await prisma.buyer.create({
    data: { companyId: company.id, email: "q-buyer@example.com" },
  });
  return { shop, company, buyer };
}

const sampleLines = () => [
  { variantId: "gid://shopify/ProductVariant/1", sku: "A-1", title: "Widget", quantity: 10, price: "9.50" },
  { variantId: "gid://shopify/ProductVariant/2", sku: "B-2", title: "Gadget", quantity: 4, price: "20.00" },
];

async function eventTypes(quoteId: string): Promise<string[]> {
  const events = await prisma.event.findMany({
    where: { entityType: "Quote", entityId: quoteId },
    orderBy: { createdAt: "asc" },
  });
  return events.map((e) => e.type);
}

describe.skipIf(!hasDb)("quote operations (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("submitQuote creates a SUBMITTED quote with lines, expiry, and an event", async () => {
    const { company, buyer } = await makeCompanyBuyer(14);
    const now = new Date("2026-07-18T00:00:00Z");

    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
      now,
    });

    expect(quote.status).toBe("SUBMITTED");
    expect(quote.lines).toHaveLength(2);
    expect(Math.round((quote.expiresAt.getTime() - now.getTime()) / DAY)).toBe(14);
    expect(await eventTypes(quote.id)).toEqual(["QUOTE_SUBMITTED"]);
  });

  it("walks the full happy path submit → counter → accept → ordered, one event each", async () => {
    const { company, buyer } = await makeCompanyBuyer();
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
    });

    await counterQuote(quote.id, {
      lines: [{ id: quote.lines[0].id, price: "8.75", quantity: 12 }],
    });
    await acceptQuote(quote.id);
    const ordered = await markOrdered(quote.id, {
      draftOrderId: "gid://shopify/DraftOrder/55",
      totalsSnapshot: { total: "150.00", currencyCode: "USD" },
    });

    expect(ordered.status).toBe("ORDERED");
    expect(ordered.draftOrderId).toBe("gid://shopify/DraftOrder/55");
    expect(ordered.totalsSnapshot).toEqual({ total: "150.00", currencyCode: "USD" });

    const revised = ordered.lines.find((l) => l.id === quote.lines[0].id)!;
    expect(revised.price.toString()).toBe("8.75");
    expect(revised.quantity).toBe(12);

    expect(await eventTypes(quote.id)).toEqual([
      "QUOTE_SUBMITTED",
      "QUOTE_COUNTERED",
      "QUOTE_ACCEPTED",
      "QUOTE_ORDERED",
    ]);
  });

  it("rejects accepting a SUBMITTED quote and writes no extra event", async () => {
    const { company, buyer } = await makeCompanyBuyer();
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
    });

    await expect(acceptQuote(quote.id)).rejects.toBeInstanceOf(
      IllegalQuoteTransitionError,
    );
    expect(await eventTypes(quote.id)).toEqual(["QUOTE_SUBMITTED"]);
    const still = await getQuote(quote.id);
    expect(still!.status).toBe("SUBMITTED");
  });

  it("rejects reopening a terminal (ORDERED) quote", async () => {
    const { company, buyer } = await makeCompanyBuyer();
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
    });
    await counterQuote(quote.id);
    await acceptQuote(quote.id);
    await markOrdered(quote.id);

    await expect(expireQuote(quote.id)).rejects.toBeInstanceOf(
      IllegalQuoteTransitionError,
    );
    await expect(counterQuote(quote.id)).rejects.toBeInstanceOf(
      IllegalQuoteTransitionError,
    );
  });

  it("manually expires a non-terminal quote with an event", async () => {
    const { company, buyer } = await makeCompanyBuyer();
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
    });

    const expired = await expireQuote(quote.id);
    expect(expired.status).toBe("EXPIRED");
    expect(await eventTypes(quote.id)).toEqual([
      "QUOTE_SUBMITTED",
      "QUOTE_EXPIRED",
    ]);
  });

  it("auto-expires on read once the expiry has passed (and only once)", async () => {
    const { company, buyer } = await makeCompanyBuyer(14);
    const now = new Date("2026-07-18T00:00:00Z");
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
      now,
    });

    const later = new Date(now.getTime() + 15 * DAY);
    const read1 = await getQuote(quote.id, { now: later });
    const read2 = await getQuote(quote.id, { now: later });

    expect(read1!.status).toBe("EXPIRED");
    expect(read2!.status).toBe("EXPIRED");
    // Exactly one expiry event, despite two reads.
    expect(await eventTypes(quote.id)).toEqual([
      "QUOTE_SUBMITTED",
      "QUOTE_EXPIRED",
    ]);
  });

  it("auto-expires (and persists it) before rejecting a transition on an expired quote", async () => {
    const { company, buyer } = await makeCompanyBuyer(14);
    const now = new Date("2026-07-18T00:00:00Z");
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
      now,
    });

    const later = new Date(now.getTime() + 20 * DAY);
    await expect(counterQuote(quote.id, { now: later })).rejects.toBeInstanceOf(
      IllegalQuoteTransitionError,
    );

    // The auto-expiry was committed even though the counter was rejected.
    const after = await prisma.quote.findUnique({ where: { id: quote.id } });
    expect(after!.status).toBe("EXPIRED");
    expect(await eventTypes(quote.id)).toEqual([
      "QUOTE_SUBMITTED",
      "QUOTE_EXPIRED",
    ]);
  });

  it("expireQuotesDue expires only the due, non-terminal quotes", async () => {
    const { company, buyer } = await makeCompanyBuyer(14);
    const now = new Date("2026-07-18T00:00:00Z");

    const dueA = await submitQuote({ companyId: company.id, buyerId: buyer.id, lines: sampleLines(), now });
    const dueB = await submitQuote({ companyId: company.id, buyerId: buyer.id, lines: sampleLines(), now });
    const fresh = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
      now: new Date(now.getTime() + 30 * DAY),
    });

    const runAt = new Date(now.getTime() + 15 * DAY);
    const count = await expireQuotesDue({ now: runAt });

    expect(count).toBe(2);
    expect((await prisma.quote.findUnique({ where: { id: dueA.id } }))!.status).toBe("EXPIRED");
    expect((await prisma.quote.findUnique({ where: { id: dueB.id } }))!.status).toBe("EXPIRED");
    expect((await prisma.quote.findUnique({ where: { id: fresh.id } }))!.status).toBe("SUBMITTED");
  });

  it("applies at most one transition under concurrent counters", async () => {
    const { company, buyer } = await makeCompanyBuyer();
    const quote = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: sampleLines(),
    });

    const results = await Promise.allSettled([
      counterQuote(quote.id),
      counterQuote(quote.id),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).toBe(1);

    const countered = await prisma.event.count({
      where: { entityId: quote.id, type: "QUOTE_COUNTERED" },
    });
    expect(countered).toBe(1);
  });
});
