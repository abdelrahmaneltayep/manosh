import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  cleanupUninstall,
  collectCustomerData,
  redactCustomer,
  redactShop,
} from "./gdpr.server";
import { submitQuote } from "./quote.server";

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedShop(domain: string, buyerEmail: string) {
  const shop = await prisma.shop.create({ data: { shopifyDomain: domain } });
  const company = await prisma.company.create({
    data: { shopId: shop.id, shopifyCompanyId: `gid://c/${domain}`, name: "Co" },
  });
  const buyer = await prisma.buyer.create({
    data: { companyId: company.id, email: buyerEmail },
  });
  await submitQuote({
    companyId: company.id,
    buyerId: buyer.id,
    lines: [{ variantId: "gid://v/1", sku: "A-1", title: "Widget", quantity: 2, price: "9.50" }],
  });
  await prisma.session.create({
    data: { id: `offline_${domain}`, shop: domain, state: "s", accessToken: "t" },
  });
  return { shop, company, buyer };
}

describe.skipIf(!hasDb)("GDPR redaction", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","ReorderSource","Buyer","Company","Shop","Session" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("shop/redact cascade-deletes everything under the shop (and its sessions)", async () => {
    await seedShop("a.myshopify.com", "a@x.com");
    await seedShop("b.myshopify.com", "b@x.com");

    await redactShop("a.myshopify.com");

    expect(await prisma.shop.count()).toBe(1);
    expect(await prisma.company.count()).toBe(1); // only b's
    expect(await prisma.buyer.count()).toBe(1);
    expect(await prisma.quote.count()).toBe(1);
    expect(await prisma.quoteLine.count()).toBe(1);
    expect(await prisma.event.count()).toBe(1);
    expect(await prisma.session.findMany({ where: { shop: "a.myshopify.com" } })).toHaveLength(0);
    // b untouched
    expect(await prisma.shop.findFirst({ where: { shopifyDomain: "b.myshopify.com" } })).not.toBeNull();
  });

  it("customers/redact deletes the buyer + their quotes/lines only", async () => {
    const { company } = await seedShop("a.myshopify.com", "target@x.com");
    // A second buyer on the same shop that must survive.
    const other = await prisma.buyer.create({
      data: { companyId: company.id, email: "keep@x.com" },
    });
    await submitQuote({
      companyId: company.id,
      buyerId: other.id,
      lines: [{ variantId: "gid://v/2", sku: "B-2", title: "Gadget", quantity: 1, price: "5.00" }],
    });

    const count = await redactCustomer("a.myshopify.com", { email: "target@x.com" });
    expect(count).toBe(1);

    expect(await prisma.buyer.findFirst({ where: { email: "target@x.com" } })).toBeNull();
    expect(await prisma.buyer.findFirst({ where: { email: "keep@x.com" } })).not.toBeNull();
    // Only the surviving buyer's quote/line remain.
    expect(await prisma.quote.count()).toBe(1);
    expect(await prisma.quoteLine.count()).toBe(1);
  });

  it("customers/redact with no email is a no-op", async () => {
    await seedShop("a.myshopify.com", "a@x.com");
    expect(await redactCustomer("a.myshopify.com", { email: null })).toBe(0);
    expect(await prisma.buyer.count()).toBe(1);
  });

  it("collectCustomerData returns the buyer with quotes", async () => {
    await seedShop("a.myshopify.com", "a@x.com");
    const data = await collectCustomerData("a.myshopify.com", { email: "a@x.com" });
    expect(data.buyers).toHaveLength(1);
    expect(data.buyers[0].quotes[0].lines).toHaveLength(1);
  });

  it("cleanupUninstall removes only the shop's sessions", async () => {
    await seedShop("a.myshopify.com", "a@x.com");
    await seedShop("b.myshopify.com", "b@x.com");
    await cleanupUninstall("a.myshopify.com");
    expect(await prisma.session.findMany({ where: { shop: "a.myshopify.com" } })).toHaveLength(0);
    expect(await prisma.session.findMany({ where: { shop: "b.myshopify.com" } })).toHaveLength(1);
    // Uninstall does NOT erase shop data (that's shop/redact's job).
    expect(await prisma.shop.count()).toBe(2);
  });
});
