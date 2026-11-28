// Phase 3 backfill: turn open storefront requests from known buyers into
// quotes with status New. Safe to run any number of times: a request becomes
// at most one quote (it is marked converted in the quote's own transaction).
// Requests from new emails, or whose items aren't in the catalog, stay in
// Requests for the merchant to decide.
//
//   npx tsx scripts/backfill-requests-to-quotes.mts [shop.myshopify.com]
import prisma from "../app/db.server";
import { convertPendingRequests } from "../app/services/quote-widget.server";

const only = process.argv[2];
const shops = await prisma.shop.findMany({
  where: { ...(only ? { shopifyDomain: only } : {}), quoteRequests: { some: { status: "NEW" } } },
  select: { shopifyDomain: true },
});
let converted = 0;
let left = 0;
for (const shop of shops) {
  const r = await convertPendingRequests(shop.shopifyDomain);
  converted += r.converted;
  left += r.left;
  console.log(`${shop.shopifyDomain}: ${r.converted} converted, ${r.left} left in Requests`);
}
console.log(JSON.stringify({ shops: shops.length, converted, left }));
await prisma.$disconnect();
