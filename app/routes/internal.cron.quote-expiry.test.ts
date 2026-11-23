import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import prisma from "../db.server";
import { action, loader } from "./internal.cron.quote-expiry";

const hasDb = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;
const URL_ = "https://manosh.fly.dev/internal/cron/quote-expiry";

const call = (fn: typeof action, headers: Record<string, string> = {}, method = "POST") =>
  fn({ request: new Request(URL_, { method, headers }), params: {}, context: {} } as never) as Promise<Response>;

describe("quote-expiry cron: authorisation", () => {
  const before = process.env.CRON_SECRET;
  afterEach(() => {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  });

  it("answers 503 when CRON_SECRET is not configured (never runs open)", async () => {
    delete process.env.CRON_SECRET;
    expect((await call(action, { "x-cron-secret": "anything" })).status).toBe(503);
  });

  it("answers 401 without the secret or with a wrong one", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await call(action)).status).toBe(401);
    expect((await call(action, { "x-cron-secret": "nope" })).status).toBe(401);
    expect((await call(loader as never, { "x-cron-secret": "nope" }, "GET")).status).toBe(401);
  });
});

describe.skipIf(!hasDb)("quote-expiry cron: sweep (DB)", () => {
  const before = process.env.CRON_SECRET;
  beforeEach(async () => {
    process.env.CRON_SECRET = "s3cret";
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
    await prisma.$disconnect();
  });

  async function seed(domain: string) {
    const shop = await prisma.shop.create({ data: { shopifyDomain: domain } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: `gid://c/${domain}`, name: "Co" } });
    const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: `b@${domain}` } });
    const quote = (status: "SUBMITTED" | "COUNTERED" | "ACCEPTED" | "ORDERED", offsetDays: number) =>
      prisma.quote.create({ data: { companyId: company.id, buyerId: buyer.id, status, expiresAt: new Date(Date.now() + offsetDays * DAY) } });
    return { shop, quote };
  }
  const statusOf = async (id: string) => (await prisma.quote.findUniqueOrThrow({ where: { id } })).status;

  it("expires every overdue open quote, in every shop, and records one event each", async () => {
    const a = await seed("a.myshopify.com");
    const b = await seed("b.myshopify.com");
    const overdueNew = await a.quote("SUBMITTED", -3);
    const overdueCountered = await a.quote("COUNTERED", -1);
    const overdueOtherShop = await b.quote("ACCEPTED", -10);
    const stillOpen = await a.quote("SUBMITTED", 5);
    const alreadyOrdered = await a.quote("ORDERED", -30);

    const res = await call(action, { "x-cron-secret": "s3cret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, expired: 3 });

    expect(await statusOf(overdueNew.id)).toBe("EXPIRED");
    expect(await statusOf(overdueCountered.id)).toBe("EXPIRED");
    expect(await statusOf(overdueOtherShop.id)).toBe("EXPIRED");
    expect(await statusOf(stillOpen.id)).toBe("SUBMITTED");
    expect(await statusOf(alreadyOrdered.id)).toBe("ORDERED"); // an order is never un-done
    expect(await prisma.event.count({ where: { type: "QUOTE_EXPIRED" } })).toBe(3);
    expect(await prisma.event.count({ where: { type: "QUOTE_EXPIRED", shopId: b.shop.id } })).toBe(1);
  });

  it("is idempotent: a second run expires nothing and writes no more events", async () => {
    const a = await seed("c.myshopify.com");
    await a.quote("SUBMITTED", -2);
    await call(action, { "x-cron-secret": "s3cret" });
    const again = await call(loader as never, { "x-cron-secret": "s3cret" }, "GET");
    expect(await again.json()).toMatchObject({ ok: true, expired: 0 });
    expect(await prisma.event.count({ where: { type: "QUOTE_EXPIRED" } })).toBe(1);
  });
});
