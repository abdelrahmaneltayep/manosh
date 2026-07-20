import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { ensureShopInstalled } from "./shop.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("ensureShopInstalled (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates the shop, starts the trial, and records APP_INSTALLED", async () => {
    const now = new Date("2026-07-20T00:00:00Z");
    const { shopId, created } = await ensureShopInstalled("new.myshopify.com", {
      now,
      trialDays: 14,
    });

    expect(created).toBe(true);
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop.plan).toBe("TRIAL");
    expect(shop.trialEndsAt?.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(await prisma.event.count({ where: { shopId, type: "APP_INSTALLED" } })).toBe(1);
  });

  it("is idempotent — a second call adds no shop and no extra event", async () => {
    const first = await ensureShopInstalled("dup.myshopify.com");
    const second = await ensureShopInstalled("dup.myshopify.com");

    expect(second.created).toBe(false);
    expect(second.shopId).toBe(first.shopId);
    expect(await prisma.shop.count({ where: { shopifyDomain: "dup.myshopify.com" } })).toBe(1);
    expect(await prisma.event.count({ where: { type: "APP_INSTALLED" } })).toBe(1);
  });
});
