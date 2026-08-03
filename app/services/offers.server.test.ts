import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { createRule, listRules, createOffer, counterOffer, listOffers, OfferRuleCapError } from "./offers.server";

const hasDb = Boolean(process.env.DATABASE_URL);

async function growthShop(domain = "off.myshopify.com") {
  return prisma.shop.create({ data: { shopifyDomain: domain, plan: "GROWTH" } });
}

describe.skipIf(!hasDb)("offers.server (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "OfferMessage","Offer","OfferRule","OfferWidgetConfig","Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const ruleInput = { name: "r", minAcceptPctOfList: 0.9, autoDeclineBelowPctOfList: 0.6, marginFloorPct: 0.25 };

  it("enforces the plan's offer-rule cap (Growth = 3)", async () => {
    await growthShop();
    for (let i = 0; i < 3; i++) expect(await createRule("off.myshopify.com", { ...ruleInput, name: `r${i}` })).toHaveProperty("id");
    await expect(createRule("off.myshopify.com", ruleInput)).rejects.toBeInstanceOf(OfferRuleCapError);
    expect(await listRules("off.myshopify.com")).toHaveLength(3);
  });

  it("creates an offer with a buyer message and lands in the queue", async () => {
    await growthShop();
    const res = await createOffer("off.myshopify.com", {
      buyerEmail: "Buyer@X.com",
      lineItems: [{ variantId: "gid://v/1", quantity: 2, listPrice: 10 }],
      offeredTotal: 15,
    });
    expect(res).toHaveProperty("offerId");
    const list = await listOffers("off.myshopify.com");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ buyerEmail: "buyer@x.com", listPriceTotal: 20, offeredTotal: 15, status: "PENDING" });

    // Merchant counters → status + counter recorded + a merchant message.
    const c = await counterOffer("off.myshopify.com", (res as { offerId: string }).offerId, 18, "meet in the middle");
    expect(c.ok).toBe(true);
    const after = await listOffers("off.myshopify.com");
    expect(after[0]).toMatchObject({ status: "COUNTERED", currentCounterTotal: 18 });
  });
});
