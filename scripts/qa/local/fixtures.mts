/*
 * Local QA fixtures, run after prisma/seed.ts: the offline Shopify session the
 * app needs to call the (mock) Admin API for the seeded shop. Prints JSON.
 * Never run against a production database (it refuses non-local hosts).
 */
import prisma from "../../../app/db.server";

const url = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("fixtures.mts only runs against a local database");
  process.exit(2);
}
const shop = process.env.MANNON_QA_SHOP || "mannon-dev.myshopify.com";
await prisma.session.upsert({
  where: { id: `offline_${shop}` },
  create: { id: `offline_${shop}`, shop, state: "", isOnline: false, scope: process.env.SCOPES || "", accessToken: "shpat_local_mock" },
  update: { scope: process.env.SCOPES || "", accessToken: "shpat_local_mock", expires: null },
});
// The plan Shopify's subscription webhook would have written (MANNON_QA_PLAN,
// default SCALE), so the run reaches every feature page, not the upgrade notes.
const plan = (process.env.MANNON_QA_PLAN || "Scale").toUpperCase() as "FREE" | "STARTER" | "GROWTH" | "SCALE";
await prisma.shop.update({ where: { shopifyDomain: shop }, data: { plan, legacyPlan: false } });
const buyer = await prisma.buyer.findFirst({ where: { email: "buyer@acme-wholesale.example" }, select: { id: true } });
console.log(JSON.stringify({ shop, plan, buyerId: buyer?.id ?? null }));
await prisma.$disconnect();
