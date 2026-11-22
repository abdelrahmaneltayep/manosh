import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { filterQuotes } from "../lib/quote-views";
import { getAttentionCounts } from "./home.server";
import { listQuotesForShop } from "./quote-inbox.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!hasDb)("getAttentionCounts (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("counts quotes to price like the Needs reply view: overdue quotes are left out", async () => {
    const domain = "attention.myshopify.com";
    const shop = await prisma.shop.create({ data: { shopifyDomain: domain } });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/att", name: "Attention Co." },
    });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "att@example.com" } });
    const now = new Date();
    const quote = (status: "SUBMITTED" | "COUNTERED", days: number) =>
      prisma.quote.create({
        data: { companyId: company.id, buyerId: buyer.id, status, expiresAt: new Date(now.getTime() + days * DAY) },
      });
    await quote("SUBMITTED", 10); // waiting on a price
    await quote("SUBMITTED", 1); // waiting on a price, and expiring soon
    await quote("SUBMITTED", -7); // past its date, not yet swept → shown as Expired
    await quote("COUNTERED", 2); // answered, expiring soon
    await quote("COUNTERED", -13); // past its date

    const counts = await getAttentionCounts(shop.id, now);

    expect(counts.quotesToPrice).toBe(2);
    expect(counts.expiringSoon).toBe(2);
    // Home's "Price quotes" row links to this view, so the two must agree.
    const needsReply = filterQuotes(await listQuotesForShop(domain), "needs-reply", "");
    expect(needsReply).toHaveLength(counts.quotesToPrice);
  });
});
