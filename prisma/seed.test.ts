import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../app/db.server";
import { seed } from "./seed";

const hasDb = Boolean(process.env.DATABASE_URL);

// Requires a live Postgres (DATABASE_URL). Self-skips otherwise so `npm test`
// still passes in a bare environment; run against a real DB to verify S2.
describe.skipIf(!hasDb)("prisma seed", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","ReorderSource","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs and its relationships resolve (Shop → Company → Buyer + ReorderSource)", async () => {
    const { shop, company, buyer, reorderSource } = await seed();

    expect(shop.shopifyDomain).toBe("mannon-dev.myshopify.com");

    const loaded = await prisma.shop.findUnique({
      where: { id: shop.id },
      include: {
        companies: { include: { buyers: true, reorderSources: true } },
      },
    });

    expect(loaded).not.toBeNull();
    expect(loaded!.companies).toHaveLength(1);
    expect(loaded!.companies[0].id).toBe(company.id);
    expect(loaded!.companies[0].buyers.map((b) => b.id)).toContain(buyer.id);
    expect(loaded!.companies[0].reorderSources.map((r) => r.id)).toContain(
      reorderSource.id,
    );
  });

  it("is idempotent — repeated runs create no duplicates", async () => {
    await seed();
    await seed();

    const shopCount = await prisma.shop.count({
      where: { shopifyDomain: "mannon-dev.myshopify.com" },
    });
    expect(shopCount).toBe(1);

    const companyCount = await prisma.company.count();
    expect(companyCount).toBe(1);

    // Event is append-only, but the demo install event is guarded to append once.
    const installEvents = await prisma.event.count({
      where: { type: "APP_INSTALLED" },
    });
    expect(installEvents).toBe(1);
  });
});
