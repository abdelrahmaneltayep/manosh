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
