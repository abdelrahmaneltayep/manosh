import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { EventType } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { submitQuote } from "./quote.server";
import {
  addDecimal,
  getDashboardMetrics,
  median,
  sumRevenue,
  timeToQuoteDurations,
} from "./dashboard.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;

describe("addDecimal (exact money addition, never a float)", () => {
  it("adds two 2dp amounts without float drift", () => {
    // 0.1 + 0.2 is 0.30000000000000004 as a float — must be exactly "0.30".
    expect(addDecimal("0.10", "0.20")).toBe("0.30");
    expect(addDecimal("1234.56", "1000.44")).toBe("2235.00");
  });

  it("aligns differing fractional lengths and carries", () => {
    expect(addDecimal("9.9", "0.15")).toBe("10.05");
    expect(addDecimal("0", "0")).toBe("0");
  });

  it("handles integer (zero-decimal) currencies", () => {
    expect(addDecimal("1000", "500")).toBe("1500");
  });
});

describe("sumRevenue (pure)", () => {
  it("sums per currency, largest total first", () => {
    const result = sumRevenue([
      { total: "100.00", currencyCode: "USD" },
      { total: "50.50", currencyCode: "USD" },
      { total: "200.00", currencyCode: "EUR" },
    ]);
    expect(result).toEqual([
      { currencyCode: "EUR", amount: "200.00" },
      { currencyCode: "USD", amount: "150.50" },
    ]);
  });

  it("returns an empty array when there are no orders", () => {
    expect(sumRevenue([])).toEqual([]);
  });
});

describe("median (pure)", () => {
  it("returns the middle of an odd list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the two middles of an even list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });
});

describe("timeToQuoteDurations (pure)", () => {
  const ev = (type: EventType, entityId: string, ms: number): {
    type: EventType;
    entityId: string;
    createdAt: Date;
  } => ({ type, entityId, createdAt: new Date(ms) });

  it("pairs each quote's first submit with its first counter", () => {
    const durations = timeToQuoteDurations([
      ev("QUOTE_SUBMITTED", "q1", 0),
      ev("QUOTE_SUBMITTED", "q2", 0),
      ev("QUOTE_COUNTERED", "q1", 2 * DAY),
      ev("QUOTE_COUNTERED", "q2", 1 * DAY),
    ]);
    expect(durations.sort((a, b) => a - b)).toEqual([1 * DAY, 2 * DAY]);
  });

  it("ignores quotes that were submitted but never countered", () => {
    const durations = timeToQuoteDurations([
      ev("QUOTE_SUBMITTED", "q1", 0),
      ev("QUOTE_COUNTERED", "q1", DAY),
      ev("QUOTE_SUBMITTED", "q2", 0), // no counter → excluded
    ]);
    expect(durations).toEqual([DAY]);
  });

  it("ignores a bare counter with no matching submit", () => {
    expect(timeToQuoteDurations([ev("QUOTE_COUNTERED", "orphan", DAY)])).toEqual([]);
  });
});

describe.skipIf(!hasDb)("getDashboardMetrics (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedShop(domain: string) {
    const shop = await prisma.shop.create({
      data: { shopifyDomain: domain, quoteExpiryDays: 14 },
    });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: `gid://c/${domain}`, name: `Co ${domain}` },
    });
    const buyer = await prisma.buyer.create({
      data: { companyId: company.id, email: `b@${domain}` },
    });
    return { shop, company, buyer };
  }

  it("reports the empty state before any activity", async () => {
    const { shop } = await seedShop("empty.myshopify.com");
    const metrics = await getDashboardMetrics(shop.id);
    expect(metrics.hasActivity).toBe(false);
    expect(metrics.revenue).toEqual([]);
    expect(metrics.quotesSent).toBe(0);
    expect(metrics.medianTimeToQuoteMs).toBeNull();
    expect(metrics.expiringSoon).toEqual([]);
  });

  it("counts quotes/reorders and sums revenue from ORDERED snapshots", async () => {
    const { shop, company, buyer } = await seedShop("busy.myshopify.com");

    // Two submitted quotes; one becomes an order with a Shopify totals snapshot.
    const q1 = await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: [{ variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 10, price: "9.50" }],
    });
    await submitQuote({
      companyId: company.id,
      buyerId: buyer.id,
      lines: [{ variantId: "gid://v/2", sku: "B-2", title: "Gadget", quantity: 2, price: "20.00" }],
    });

    // Mark q1 ORDERED with a money snapshot (as acceptAndOrder would).
    await prisma.quote.update({
      where: { id: q1.id },
      data: {
        status: "ORDERED",
        totalsSnapshot: { subtotal: "95.00", totalTax: "5.00", total: "100.00", currencyCode: "USD" },
      },
    });
    await appendEvent({ shopId: shop.id, type: "QUOTE_ACCEPTED", entityType: "Quote", entityId: q1.id });
    await appendEvent({ shopId: shop.id, type: "QUOTE_ORDERED", entityType: "Quote", entityId: q1.id });
    await appendEvent({ shopId: shop.id, type: "REORDER_CREATED", entityType: "Quote" });

    const metrics = await getDashboardMetrics(shop.id);
    expect(metrics.hasActivity).toBe(true);
    expect(metrics.quotesSent).toBe(2);
    expect(metrics.quotesAccepted).toBe(1);
    expect(metrics.ordersCount).toBe(1);
    expect(metrics.reorders).toBe(1);
    expect(metrics.revenue).toEqual([{ currencyCode: "USD", amount: "100.00" }]);
  });

  it("computes median time-to-quote from the event stream", async () => {
    const { shop, company, buyer } = await seedShop("timing.myshopify.com");
    const base = new Date("2026-07-01T00:00:00Z");

    const q1 = await submitQuote({
      companyId: company.id, buyerId: buyer.id, now: base,
      lines: [{ variantId: "gid://v/1", title: "W", quantity: 1, price: "1.00" }],
    });
    // Counter it 2 days later via a direct event (the machine is tested elsewhere).
    await appendEvent({
      shopId: shop.id, type: "QUOTE_COUNTERED", entityType: "Quote", entityId: q1.id,
    });
    // Override the counter event's timestamp deterministically.
    await prisma.event.updateMany({
      where: { entityId: q1.id, type: "QUOTE_COUNTERED" },
      data: { createdAt: new Date(base.getTime() + 2 * DAY) },
    });
    await prisma.event.updateMany({
      where: { entityId: q1.id, type: "QUOTE_SUBMITTED" },
      data: { createdAt: base },
    });

    const metrics = await getDashboardMetrics(shop.id);
    expect(metrics.medianTimeToQuoteMs).toBe(2 * DAY);
  });

  it("lists active quotes expiring within the window, and no other shop's", async () => {
    const now = new Date("2026-07-18T00:00:00Z");
    const { shop, company, buyer } = await seedShop("expiry.myshopify.com");
    const other = await seedShop("other.myshopify.com");

    // Expiring in 1 day → in window.
    await prisma.quote.create({
      data: {
        companyId: company.id, buyerId: buyer.id, status: "SUBMITTED",
        expiresAt: new Date(now.getTime() + 1 * DAY),
      },
    });
    // Expiring in 30 days → outside the 3-day window.
    await prisma.quote.create({
      data: {
        companyId: company.id, buyerId: buyer.id, status: "COUNTERED",
        expiresAt: new Date(now.getTime() + 30 * DAY),
      },
    });
    // Another shop's soon-to-expire quote must not leak in.
    await prisma.quote.create({
      data: {
        companyId: other.company.id, buyerId: other.buyer.id, status: "SUBMITTED",
        expiresAt: new Date(now.getTime() + 1 * DAY),
      },
    });

    const metrics = await getDashboardMetrics(shop.id, { now });
    expect(metrics.expiringSoon).toHaveLength(1);
    expect(metrics.expiringSoon[0].companyName).toBe("Co expiry.myshopify.com");
    expect(metrics.expiringSoon[0].status).toBe("SUBMITTED");
  });
})
