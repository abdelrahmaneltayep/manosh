import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  getShopSettings,
  updateShopSettings,
  validateSettings,
} from "./settings.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("validateSettings (pure)", () => {
  const base = { autoApproveTolerance: 0.05, quoteExpiryDays: 14, magicLinkExpiryDays: 7 };

  it("accepts valid settings", () => {
    expect(validateSettings(base).ok).toBe(true);
  });

  it("rejects a tolerance outside 0..1", () => {
    expect(validateSettings({ ...base, autoApproveTolerance: 1.5 }).ok).toBe(false);
    expect(validateSettings({ ...base, autoApproveTolerance: -0.1 }).ok).toBe(false);
  });

  it("rejects out-of-range expiries", () => {
    expect(validateSettings({ ...base, quoteExpiryDays: 0 }).ok).toBe(false);
    expect(validateSettings({ ...base, quoteExpiryDays: 400 }).ok).toBe(false);
    expect(validateSettings({ ...base, magicLinkExpiryDays: 120 }).ok).toBe(false);
    expect(validateSettings({ ...base, quoteExpiryDays: 1.5 }).ok).toBe(false);
  });
});

describe.skipIf(!hasDb)("shop settings (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Shop" RESTART IDENTITY CASCADE');
    await prisma.shop.create({ data: { shopifyDomain: "settings.myshopify.com" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reads defaults then persists an update", async () => {
    const before = await getShopSettings("settings.myshopify.com");
    expect(before).toMatchObject({ autoApproveTolerance: 0, quoteExpiryDays: 14, magicLinkExpiryDays: 7 });

    await updateShopSettings("settings.myshopify.com", {
      autoApproveTolerance: 0.1,
      quoteExpiryDays: 30,
      magicLinkExpiryDays: 14,
    });

    const after = await getShopSettings("settings.myshopify.com");
    expect(after).toMatchObject({ autoApproveTolerance: 0.1, quoteExpiryDays: 30, magicLinkExpiryDays: 14 });
  });
});
