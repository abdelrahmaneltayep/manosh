import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import prisma from "../db.server";
import { getCatalog, clearCatalogCache, type CatalogItem } from "./catalog.server";
import { setMailTransport, type EmailMessage } from "./mailer.server";
import { convertPendingRequests, convertToQuote, createQuoteRequest } from "./quote-widget.server";

// Phase 3: a storefront request becomes a quote with status New.
const hasDb = Boolean(process.env.DATABASE_URL);
const DOMAIN = "req.myshopify.com";
const CATALOG: CatalogItem[] = [
  { variantId: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/1", productTitle: "Mug", variantTitle: "12oz", displayTitle: "Mug — 12oz", sku: "MUG-12", price: "9.50", currencyCode: "USD" },
];
let outbox: EmailMessage[] = [];
let rate = 0;

async function seed(plan: "FREE" | "STARTER" | "GROWTH" = "GROWTH") {
  const shop = await prisma.shop.create({ data: { shopifyDomain: DOMAIN, name: "Req Supply", plan, quoteWidgetEnabled: true, alertEmails: ["owner@req.example"] } });
  const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/r1", name: "Known Co." } });
  const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "known@buyer.example", name: "Kim", status: "ACTIVE" } });
  return { shop, company, buyer };
}

function submit(email: string, lines = [{ variantId: "gid://shopify/ProductVariant/1", quantity: 12 }]) {
  return createQuoteRequest(DOMAIN, { email, lines, elapsedMs: 5000 } as never, { rateKey: `t${rate++}`, baseUrl: "https://app.example.com" });
}

describe.skipIf(!hasDb)("storefront request → quote", () => {
  beforeEach(async () => {
    outbox = [];
    vi.stubEnv("MANNON_FF_QUOTE_WIDGET", "true");
    vi.stubEnv("MANNON_MAIL_FROM", "quotes@support-mannon.com");
    setMailTransport(async (m) => {
      outbox.push(m);
      return { messageId: `m${outbox.length}` };
    });
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
    clearCatalogCache();
    await getCatalog(DOMAIN, { loader: async () => CATALOG });
  });
  afterEach(() => {
    setMailTransport(null);
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a known buyer's request is a quote with status New right away, emailed once", async () => {
    const { buyer } = await seed();
    const res = await submit("Known@Buyer.example");
    expect(res.ok && "quoteId" in res && res.quoteId).toBeTruthy();
    const quoteId = (res as unknown as { quoteId: string }).quoteId;
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true, fromRequest: true } });
    expect([quote.status, quote.source, quote.buyerId, quote.lines.length]).toEqual(["SUBMITTED", "WIDGET", buyer.id, 1]);
    expect(quote.fromRequest?.status).toBe("CONVERTED");
    // One alert to the merchant (linking to the quote) and one acknowledgement.
    expect(outbox.map((m) => m.to).sort()).toEqual(["Known@Buyer.example".toLowerCase(), "owner@req.example"].sort());
    expect(outbox.find((m) => m.to === "owner@req.example")?.text).toContain(`/app/quotes/${quoteId}`);
  });

  it("a new email stays a request and adds no company account", async () => {
    const { shop } = await seed();
    const res = await submit("stranger@new.example");
    expect(res.ok && !("quoteId" in res && res.quoteId)).toBe(true);
    expect(await prisma.quoteRequest.count({ where: { shopId: shop.id, status: "NEW" } })).toBe(1);
    expect(await prisma.company.count({ where: { shopId: shop.id } })).toBe(1);
    expect(outbox.find((m) => m.to === "owner@req.example")?.text).toContain("/app/quote-requests");
  });

  it("converting the same request twice gives one quote", async () => {
    const { shop } = await seed();
    const request = await prisma.quoteRequest.create({ data: { shopId: shop.id, email: "known@buyer.example", lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 3 }] } });
    const first = await convertToQuote(DOMAIN, request.id);
    const second = await convertToQuote(DOMAIN, request.id);
    expect(first).toEqual(second);
    expect(await prisma.quote.count({ where: { company: { shopId: shop.id } } })).toBe(1);
  });

  it("two conversions racing still give one quote", async () => {
    const { shop } = await seed();
    const request = await prisma.quoteRequest.create({ data: { shopId: shop.id, email: "known@buyer.example", lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 3 }] } });
    const [a, b] = await Promise.all([convertToQuote(DOMAIN, request.id), convertToQuote(DOMAIN, request.id)]);
    expect(a.ok && b.ok).toBe(true);
    expect(a).toEqual(b);
    expect(await prisma.quote.count({ where: { company: { shopId: shop.id } } })).toBe(1);
  });

  it("a merchant creating the quote doesn't email the buyer or the merchant again", async () => {
    const { shop } = await seed("GROWTH");
    const request = await prisma.quoteRequest.create({ data: { shopId: shop.id, email: "stranger@new.example", lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 3 }] } });
    expect((await convertToQuote(DOMAIN, request.id)).ok).toBe(true);
    expect(outbox).toHaveLength(0);
  });

  it("the backfill is safe to run twice", async () => {
    const { shop } = await seed();
    await prisma.quoteRequest.createMany({
      data: [
        { shopId: shop.id, email: "known@buyer.example", lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }] },
        { shopId: shop.id, email: "known@buyer.example", lines: [{ sku: "mug-12", quantity: 2 }] },
        { shopId: shop.id, email: "stranger@new.example", lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }] },
        { shopId: shop.id, email: "known@buyer.example", lines: [{ sku: "NOT-IN-CATALOG", quantity: 1 }] },
      ],
    });
    expect(await convertPendingRequests(DOMAIN)).toEqual({ converted: 2, left: 2 });
    expect(await convertPendingRequests(DOMAIN)).toEqual({ converted: 0, left: 2 });
    expect(await prisma.quote.count({ where: { company: { shopId: shop.id }, source: "WIDGET", status: "SUBMITTED" } })).toBe(2);
  });

  it("the source migration is safe to run twice", async () => {
    const { shop, company, buyer } = await seed();
    const quote = await prisma.quote.create({ data: { companyId: company.id, buyerId: buyer.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.quoteRequest.create({ data: { shopId: shop.id, email: buyer.email, lines: [], status: "CONVERTED", convertedQuoteId: quote.id } });
    const sql = readFileSync("prisma/migrations/20261128150000_storefront_quote_source/migration.sql", "utf8");
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).source).toBe("WIDGET");
  });
});
