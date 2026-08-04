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

/**
 * app/uninstalled (BFS §3.1). Two things, immediately (full data erasure follows
 * ~48h later via shop/redact):
 *  1. Revoke tokens — delete the shop's sessions (they hold the access tokens).
 *  2. Deactivate the theme-app-extension config — so a reinstall starts clean and
 *     nothing renders on the storefront until the merchant re-enables it. Today
 *     that's the F17 Request-a-Quote widget toggle; new extension toggles are
 *     added here as they ship.
 */
export async function cleanupUninstall(shopDomain: string): Promise<void> {
  await prisma.session.deleteMany({ where: { shop: shopDomain } });
  await prisma.shop.updateMany({
    where: { shopifyDomain: shopDomain },
    data: { quoteWidgetEnabled: false },
  });
}
