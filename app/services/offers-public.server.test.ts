import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import prisma from "../db.server";
import { getOfferPublicConfig, submitPublicOffer } from "./offers.server";

/*
 * Storefront offer config. Make an Offer starts on Growth (owner decision,
 * 27 Nov 2026): on Free and Starter shoppers get no button and the config names
 * the plan, which the theme editor shows to the merchant (review 5.1.2: a block
 * must never look broken to them). A shop that is not installed is always off.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("getOfferPublicConfig (storefront rendering, 5.1.2)", () => {
  beforeEach(async () => {
    vi.stubEnv("MANNON_FF_MAKE_AN_OFFER", "true");
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Offer","OfferWidgetConfig","Buyer","Company","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("is off for a shop that is not installed", async () => {
    expect((await getOfferPublicConfig("nobody.myshopify.com")).enabled).toBe(false);
  });

  it.each(["GROWTH", "SCALE"] as const)("renders the button on the %s plan", async (plan) => {
    await prisma.shop.create({ data: { shopifyDomain: "oc.myshopify.com", plan } });
    const cfg = await getOfferPublicConfig("oc.myshopify.com");
    expect(cfg.enabled).toBe(true);
    expect(cfg.surfaces.button).toBe(true);
    expect(cfg.needsPlan).toBeUndefined();
    expect(cfg.instant).toBe(plan === "SCALE"); // instant answers stay a Scale feature
  });

  it.each(["FREE", "STARTER", "TRIAL"] as const)("is off for shoppers on the %s plan and names Growth", async (plan) => {
    await prisma.shop.create({ data: { shopifyDomain: "oc.myshopify.com", plan } });
    const cfg = await getOfferPublicConfig("oc.myshopify.com");
    expect(cfg.enabled).toBe(false);
    expect(cfg.needsPlan).toBe("Growth");
  });

  it("is off when the feature flag is off", async () => {
    await prisma.shop.create({ data: { shopifyDomain: "oc.myshopify.com", plan: "GROWTH" } });
    vi.stubEnv("MANNON_FF_MAKE_AN_OFFER", "false");
    expect((await getOfferPublicConfig("oc.myshopify.com")).enabled).toBe(false);
  });

  it("refuses an offer on Starter, where the merchant couldn't answer it", async () => {
    await prisma.shop.create({ data: { shopifyDomain: "oc.myshopify.com", plan: "STARTER" } });
    const res = await submitPublicOffer(
      "oc.myshopify.com",
      {
        buyerEmail: "buyer@example.test",
        lines: [{ variantId: "gid://shopify/ProductVariant/1", title: "Widget", sku: "W-1", quantity: 2, listPrice: 10 }],
        offeredTotal: 15,
        elapsedMs: 5000,
      },
      { rateKey: "qa-starter" },
    );
    expect(res).toEqual({ ok: false, error: "This store isn’t taking offers right now." });
    expect(await prisma.offer.count()).toBe(0);
  });
});
