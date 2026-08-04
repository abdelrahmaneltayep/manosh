import { fileURLToPath } from "node:url";
import prisma from "../app/db.server";
import { appendEvent } from "../app/services/events.server";

/**
 * Idempotent demo seed. Creates one Shop + Company + Buyer + a ReorderSource
 * pointing at a fake past order, so downstream slices (portal, reorder,
 * dashboard) have data to render. Safe to run repeatedly — every write is an
 * upsert keyed on a unique field, and the demo install event is appended only
 * once.
 */
export async function seed() {
  const shop = await prisma.shop.upsert({
    where: { shopifyDomain: "mannon-dev.myshopify.com" },
    update: {},
    create: {
      shopifyDomain: "mannon-dev.myshopify.com",
      plan: "TRIAL",
      quoteExpiryDays: 14,
      autoApproveTolerance: 0.05,
    },
  });

  const company = await prisma.company.upsert({
    where: {
      shopId_shopifyCompanyId: {
        shopId: shop.id,
        shopifyCompanyId: "gid://shopify/Company/1",
      },
    },
    update: {},
    create: {
      shopId: shop.id,
      shopifyCompanyId: "gid://shopify/Company/1",
      name: "Acme Wholesale Co.",
    },
  });

  const buyer = await prisma.buyer.upsert({
    where: {
      companyId_email: {
        companyId: company.id,
        email: "buyer@acme-wholesale.example",
      },
    },
    update: {},
    create: {
      companyId: company.id,
      email: "buyer@acme-wholesale.example",
      name: "Jordan Buyer",
      shopifyContactId: "gid://shopify/CompanyContact/1",
    },
  });

  const reorderSource = await prisma.reorderSource.upsert({
    where: {
      companyId_shopifyOrderId: {
        companyId: company.id,
        shopifyOrderId: "gid://shopify/Order/1001",
      },
    },
    update: {},
    create: {
      companyId: company.id,
      shopifyOrderId: "gid://shopify/Order/1001",
      orderName: "#1001",
      orderedAt: new Date("2026-06-01T12:00:00Z"),
      total: "1250.00",
      currency: "USD",
    },
  });

  // F21 — demo Make-an-Offer data so the Offers admin renders on a fresh install:
  // a widget config, one margin-safe rule, and a pending buyer offer to act on.
  // Idempotent: widget config is keyed by the unique shopId; the rule + offer are
  // created only if none exist yet for the shop.
  await prisma.offerWidgetConfig.upsert({
    where: { shopId: shop.id },
    update: {},
    create: { shopId: shop.id, buttonLabel: "Make an offer" },
  });

  const existingRule = await prisma.offerRule.findFirst({ where: { shopId: shop.id } });
  if (!existingRule) {
    await prisma.offerRule.create({
      data: {
        shopId: shop.id,
        name: "House rule",
        scope: "ALL",
        minAcceptPctOfList: "0.9000", // accept at ≥ 90% of list
        autoDeclineBelowPctOfList: "0.6000", // decline below 60%
        autoCounterToPctOfList: "0.8500", // counter to 85%
        marginFloorPct: "0.3000", // never below 30% margin
      },
    });
  }

  const existingOffer = await prisma.offer.findFirst({ where: { shopId: shop.id } });
  if (!existingOffer) {
    await prisma.offer.create({
      data: {
        shopId: shop.id,
        buyerEmail: buyer.email,
        companyId: company.id,
        source: "PRODUCT",
        status: "PENDING",
        lineItems: [
          { variantId: "gid://shopify/ProductVariant/1", title: "Stoneware Mug — 12oz", sku: "MUG-12", quantity: 48, listPrice: 9.5 },
        ],
        listPriceTotal: "456.00",
        offeredTotal: "372.00", // ~82% of list — lands in the counter band
        messages: {
          create: { actor: "BUYER", amountTotal: "372.00", note: "Buyer's offer" },
        },
      },
    });
  }

  // Append the demo install event only once (Event is append-only).
  const existingInstall = await prisma.event.findFirst({
    where: { shopId: shop.id, type: "APP_INSTALLED" },
  });
  if (!existingInstall) {
    await appendEvent({
      shopId: shop.id,
      type: "APP_INSTALLED",
      entityType: "Shop",
      entityId: shop.id,
    });
  }

  return { shop, company, buyer, reorderSource };
}

// Run when invoked directly (e.g. `prisma db seed`).
const isMain =
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  seed()
    .then(({ shop }) => {
      console.log(`Seeded demo data for ${shop.shopifyDomain}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
