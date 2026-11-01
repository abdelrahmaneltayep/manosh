import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import prisma from "../db.server";
import { getOfferPublicConfig, submitPublicOffer } from "./offers.server";

/*
 * Storefront offer config after the 5.1.2 fix: the Make an Offer block renders
 * on every plan, so the public config is `enabled` for any installed shop with
 * the flag on, regardless of tier — and `enabled: false` for a shop that is not
 * installed (found by the QA harness: an unknown shop briefly got a button).
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

  it.each(["FREE", "STARTER", "GROWTH", "SCALE"] as const)("renders the button on the %s plan", async (plan) => {
    await prisma.shop.create({ data: { shopifyDomain: "oc.myshopify.com", plan } });
    const cfg = await getOfferPublicConfig("oc.myshopify.com");
    expect(cfg.enabled).toBe(true);
    expect(cfg.surfaces.button).toBe(true);
    expect(cfg.instant).toBe(plan === "SCALE"); // instant answers stay a Scale feature
  });

  it("is off when the feature flag is off", async () => {
    await prisma.shop.create({ data: { shopifyDomain: "oc.myshopify.com", plan: "GROWTH" } });
    vi.stubEnv("MANNON_FF_MAKE_AN_OFFER", "false");
    expect((await getOfferPublicConfig("oc.myshopify.com")).enabled).toBe(false);
  });

  it("accepts an offer on Starter as a pending, merchant-reviewed offer", async () => {
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
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.outcome).toBe("pending");
    expect(await prisma.offer.count()).toBe(1);
  });
});
