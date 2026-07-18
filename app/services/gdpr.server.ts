import prisma from "../db.server";

/**
 * GDPR mandatory-webhook handlers (F6). See /docs/compliance.md for the exact
 * cascade. Redaction relies on the Prisma onDelete: Cascade wiring in the
 * schema, so deleting a Shop or Buyer removes everything beneath it.
 */

/** shop/redact: erase everything under the shop, plus its sessions. */
export async function redactShop(shopDomain: string): Promise<void> {
  // Deleting the Shop cascades to Company → Buyer / Quote / QuoteLine /
  // ReorderSource, and to Event.
  await prisma.shop.deleteMany({ where: { shopifyDomain: shopDomain } });
  // Sessions are keyed by shop domain (not FK-linked), so clear them too.
  await prisma.session.deleteMany({ where: { shop: shopDomain } });
}

/**
 * customers/redact: delete the matching buyer(s) for this shop, cascading to
 * their quotes and quote lines. Returns how many buyers were removed.
 */
export async function redactCustomer(
  shopDomain: string,
  customer: { email?: string | null },
): Promise<number> {
  if (!customer.email) return 0;
  const result = await prisma.buyer.deleteMany({
    where: {
      email: customer.email,
      company: { shop: { shopifyDomain: shopDomain } },
    },
  });
  return result.count;
}

/**
 * customers/data_request: assemble the data we hold on a customer so the
 * merchant can fulfil the request. We hold buyer PII plus their quotes/lines.
 */
export async function collectCustomerData(
  shopDomain: string,
  customer: { email?: string | null },
) {
  if (!customer.email) return { buyers: [] };
  const buyers = await prisma.buyer.findMany({
    where: {
      email: customer.email,
      company: { shop: { shopifyDomain: shopDomain } },
    },
    include: { quotes: { include: { lines: true } } },
  });
  return { buyers };
}

/** app/uninstalled: remove the shop's sessions immediately. */
export async function cleanupUninstall(shopDomain: string): Promise<void> {
  await prisma.session.deleteMany({ where: { shop: shopDomain } });
}
