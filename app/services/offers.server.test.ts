import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { createRule, listRules, createOffer, counterOffer, convertOffer, listOffers, getOffer, OfferRuleCapError } from "./offers.server";
import type { AdminGraphqlClient, DraftOrderInput } from "./draft-order.server";

const hasDb = Boolean(process.env.DATABASE_URL);

async function growthShop(domain = "off.myshopify.com") {
  return prisma.shop.create({ data: { shopifyDomain: domain, plan: "GROWTH" } });
}

async function scaleShop(domain = "scale.myshopify.com") {
  return prisma.shop.create({ data: { shopifyDomain: domain, plan: "SCALE" } });
}

/** Seed the persisted variant-cost cache so createOffer's margin math is real
 *  (no Shopify call needed in tests). */
async function seedCost(shopId: string, variantId: string, costPrice: number) {
  await prisma.variantCost.create({ data: { shopId, variantId, costPrice, currencyCode: "USD" } });
}

describe.skipIf(!hasDb)("offers.server (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "OfferMessage","Offer","OfferRule","OfferWidgetConfig","VariantCost","Buyer","Company","Event","Shop" RESTART IDENTITY CASCADE');
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

  it("Growth never auto-executes even with a matching accept rule (stays pending)", async () => {
    const shop = await growthShop();
    await seedCost(shop.id, "gid://v/1", 4); // cost 4, list 10 → margin at 9.5 is fine
    await createRule("off.myshopify.com", { name: "all", minAcceptPctOfList: 0.9, autoDeclineBelowPctOfList: 0.6, marginFloorPct: 0.25 });
    const res = await createOffer("off.myshopify.com", {
      buyerEmail: "b@x.com",
      lineItems: [{ variantId: "gid://v/1", quantity: 1, listPrice: 10 }],
      offeredTotal: 9.5,
    });
    expect(res).toMatchObject({ outcome: "pending" });
    expect((await listOffers("off.myshopify.com"))[0]).toMatchObject({ status: "PENDING" });
  });

  it("Scale auto-executes the engine decision (auto-decline)", async () => {
    const shop = await scaleShop();
    await seedCost(shop.id, "gid://v/1", 4);
    await createRule("scale.myshopify.com", { name: "all", minAcceptPctOfList: 0.9, autoDeclineBelowPctOfList: 0.6, marginFloorPct: 0.25 });
    const res = await createOffer("scale.myshopify.com", {
      buyerEmail: "b@x.com",
      lineItems: [{ variantId: "gid://v/1", quantity: 1, listPrice: 10 }],
      offeredTotal: 4.5, // 45% of list < 60% decline threshold
    });
    expect(res).toMatchObject({ outcome: "declined" });
    const row = (await listOffers("scale.myshopify.com"))[0];
    expect(row.status).toBe("DECLINED");
    const full = await getOffer("scale.myshopify.com", (res as { offerId: string }).offerId);
    expect(full?.handledBy).toBe("AUTO");
    expect(full?.messages.some((m) => m.actor === "SYSTEM")).toBe(true);
  });

  it("Scale auto-accepts an at-threshold, margin-safe offer", async () => {
    const shop = await scaleShop();
    await seedCost(shop.id, "gid://v/1", 4);
    await createRule("scale.myshopify.com", { name: "all", minAcceptPctOfList: 0.9, autoDeclineBelowPctOfList: 0.6, marginFloorPct: 0.25 });
    const res = await createOffer("scale.myshopify.com", {
      buyerEmail: "b@x.com",
      lineItems: [{ variantId: "gid://v/1", quantity: 1, listPrice: 10 }],
      offeredTotal: 9.5, // 95% ≥ 90%, margin (9.5-4)/9.5 ≈ 58% ≥ 25%
    });
    expect(res).toMatchObject({ outcome: "accepted" });
    expect((await listOffers("scale.myshopify.com"))[0].status).toBe("ACCEPTED");
  });

  it("converts an accepted offer to a native draft order at the agreed price", async () => {
    const shop = await scaleShop();
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/1", name: "Acme" },
    });
    await prisma.buyer.create({
      data: { companyId: company.id, email: "b@x.com", shopifyContactId: "gid://shopify/CompanyContact/1", shopifyCompanyLocationId: "gid://shopify/CompanyLocation/1" },
    });
    // An accepted offer: list 20 (2 × 10), agreed 16 (20% off).
    const offer = await prisma.offer.create({
      data: {
        shopId: shop.id, buyerEmail: "b@x.com", companyId: company.id, status: "ACCEPTED",
        lineItems: [{ variantId: "gid://v/1", quantity: 2, listPrice: 10 }],
        listPriceTotal: 20, offeredTotal: 16,
      },
      select: { id: true },
    });

    let captured: DraftOrderInput | undefined;
    const admin: AdminGraphqlClient = {
      graphql: async (_q, opts) => {
        captured = opts?.variables?.input as DraftOrderInput;
        return {
          json: async () => ({
            data: { draftOrderCreate: {
              draftOrder: { id: "gid://shopify/DraftOrder/9", subtotalPriceSet: { shopMoney: { amount: "16.00", currencyCode: "USD" } }, totalTaxSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } }, totalPriceSet: { shopMoney: { amount: "16.00", currencyCode: "USD" } } },
              userErrors: [],
            } },
          }),
        };
      },
    };

    const res = await convertOffer("scale.myshopify.com", offer.id, admin, { currencyCode: "USD" });
    expect(res).toMatchObject({ orderId: "gid://shopify/DraftOrder/9" });
    // Agreed unit price = 10 × (16/20) = 8.00; purchasing entity attached.
    expect(captured?.lineItems[0]).toMatchObject({ variantId: "gid://v/1", quantity: 2, priceOverride: { amount: "8.00", currencyCode: "USD" } });
    expect(captured?.purchasingEntity.purchasingCompany.companyId).toBe("gid://shopify/Company/1");
    const full = await getOffer("scale.myshopify.com", offer.id);
    expect(full?.status).toBe("CONVERTED");
    expect(full?.convertedOrderId).toBe("gid://shopify/DraftOrder/9");

    // A second convert is rejected (already an order).
    expect(await convertOffer("scale.myshopify.com", offer.id, admin, { currencyCode: "USD" })).toMatchObject({ error: expect.any(String) });
  });
});
