import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import prisma from "../db.server";
import { counterQuote, submitQuote } from "../services/quote.server";
import { action, loader } from "./internal.cron.expire-quotes";

const hasDb = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "test-cron-secret-0123456789";
const URL_ = "https://manosh.test/internal/cron/expire-quotes";

const lines = () => [
  { variantId: "gid://shopify/ProductVariant/1", sku: "A-1", title: "Widget", quantity: 10, price: "9.50" },
];

async function makeCompanyBuyer(domain: string) {
  const shop = await prisma.shop.create({ data: { shopifyDomain: domain, quoteExpiryDays: 14 } });
  const company = await prisma.company.create({
    data: { shopId: shop.id, shopifyCompanyId: `gid://shopify/Company/${domain}`, name: "Cron Co." },
  });
  const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: `buyer@${domain}` } });
  return { shop, company, buyer };
}

/** Push a quote's expiry into the past, as it sits on a store nobody swept. */
async function makeOverdue(quoteId: string, daysAgo: number) {
  await prisma.quote.update({
    where: { id: quoteId },
    data: { expiresAt: new Date(Date.now() - daysAgo * DAY) },
  });
}

async function statusOf(quoteId: string) {
  return (await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } })).status;
}

async function expiredEvents(quoteId: string) {
  return prisma.event.findMany({ where: { type: "QUOTE_EXPIRED", entityType: "Quote", entityId: quoteId } });
}

function call(method: "POST" | "GET", headers: Record<string, string> = {}) {
  const request = new Request(URL_, { method, headers });
  const args = { request, params: {}, context: {} };
  return method === "POST" ? action(args) : loader(args);
}

describe.skipIf(!hasDb)("/internal/cron/expire-quotes (DB)", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    savedEnv = { CRON_SECRET: process.env.CRON_SECRET, MANNON_FF_FOLLOWUPS: process.env.MANNON_FF_FOLLOWUPS };
    process.env.CRON_SECRET = SECRET;
    // Expiry is core, not an add-on: it must run with every feature flag off.
    delete process.env.MANNON_FF_FOLLOWUPS;
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("expires overdue SUBMITTED and COUNTERED quotes across every shop, one event each", async () => {
    const a = await makeCompanyBuyer("cron-a.myshopify.com");
    const b = await makeCompanyBuyer("cron-b.myshopify.com");

    const submitted = await submitQuote({ companyId: a.company.id, buyerId: a.buyer.id, lines: lines() });
    const countered = await submitQuote({ companyId: b.company.id, buyerId: b.buyer.id, lines: lines() });
    await counterQuote(countered.id);
    const fresh = await submitQuote({ companyId: a.company.id, buyerId: a.buyer.id, lines: lines() });
    // The two dates seen on the live dev store: one and two weeks overdue.
    await makeOverdue(submitted.id, 13);
    await makeOverdue(countered.id, 7);

    const res = await call("POST", { "x-cron-secret": SECRET });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, expired: 2, ranAt: expect.any(String) });
    expect(await statusOf(submitted.id)).toBe("EXPIRED");
    expect(await statusOf(countered.id)).toBe("EXPIRED");
    expect(await statusOf(fresh.id)).toBe("SUBMITTED");

    const [submittedEvent] = await expiredEvents(submitted.id);
    expect(submittedEvent).toMatchObject({
      shopId: a.shop.id,
      payload: { from: "SUBMITTED", to: "EXPIRED", reason: "auto" },
    });
    const [counteredEvent] = await expiredEvents(countered.id);
    expect(counteredEvent).toMatchObject({
      shopId: b.shop.id,
      payload: { from: "COUNTERED", to: "EXPIRED", reason: "auto" },
    });
    expect(await expiredEvents(fresh.id)).toHaveLength(0);
  });

  it("is idempotent: a second run expires nothing and appends no second event", async () => {
    const { company, buyer } = await makeCompanyBuyer("cron-a.myshopify.com");
    const quote = await submitQuote({ companyId: company.id, buyerId: buyer.id, lines: lines() });
    await makeOverdue(quote.id, 7);

    await call("POST", { "x-cron-secret": SECRET });
    const again = await call("POST", { "x-cron-secret": SECRET });

    expect(await again.json()).toMatchObject({ ok: true, expired: 0 });
    expect(await expiredEvents(quote.id)).toHaveLength(1);
  });

  it("also answers GET with the secret (schedulers that cannot POST)", async () => {
    const { company, buyer } = await makeCompanyBuyer("cron-a.myshopify.com");
    const quote = await submitQuote({ companyId: company.id, buyerId: buyer.id, lines: lines() });
    await makeOverdue(quote.id, 1);

    const res = await call("GET", { "x-cron-secret": SECRET });

    expect(res.status).toBe(200);
    expect(await statusOf(quote.id)).toBe("EXPIRED");
  });

  it.each([
    ["no secret header", {}],
    ["a wrong secret", { "x-cron-secret": "not-the-secret" }],
  ])("rejects %s with 401 and expires nothing", async (_label, headers) => {
    const { company, buyer } = await makeCompanyBuyer("cron-a.myshopify.com");
    const quote = await submitQuote({ companyId: company.id, buyerId: buyer.id, lines: lines() });
    await makeOverdue(quote.id, 7);

    for (const method of ["POST", "GET"] as const) {
      const res = await call(method, headers);
      expect(res.status).toBe(401);
    }
    expect(await statusOf(quote.id)).toBe("SUBMITTED");
    expect(await expiredEvents(quote.id)).toHaveLength(0);
  });

  it("answers 503 and expires nothing when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { company, buyer } = await makeCompanyBuyer("cron-a.myshopify.com");
    const quote = await submitQuote({ companyId: company.id, buyerId: buyer.id, lines: lines() });
    await makeOverdue(quote.id, 7);

    // An empty header must not match an unset secret.
    const res = await call("POST", { "x-cron-secret": "" });

    expect(res.status).toBe(503);
    expect(await statusOf(quote.id)).toBe("SUBMITTED");
  });
});
