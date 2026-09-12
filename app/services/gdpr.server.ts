import prisma from "../db.server";
import { sendEmail } from "./mailer.server";
import { captureException } from "../lib/sentry.server";

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
 * customers/redact: erase EVERY piece of customer PII we hold for this shop,
 * matched by email (case-insensitive). That is the buyer record (cascades to
 * quotes/lines) plus the standalone lead/PII tables that store an email outside
 * the Buyer graph: storefront offers, quote requests, public-catalog leads, and
 * wholesale applications. Returns the total number of rows removed across tables.
 */
export async function redactCustomer(
  shopDomain: string,
  customer: { email?: string | null },
): Promise<number> {
  if (!customer.email) return 0;
  const email = { equals: customer.email, mode: "insensitive" as const };
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return 0;

  const [buyers, offers, requests, leads, applications] = await prisma.$transaction([
    // Buyer cascades to Quote/QuoteLine via onDelete: Cascade.
    prisma.buyer.deleteMany({ where: { email, company: { shopId: shop.id } } }),
    prisma.offer.deleteMany({ where: { buyerEmail: email, shopId: shop.id } }),
    prisma.quoteRequest.deleteMany({ where: { email, shopId: shop.id } }),
    prisma.catalogLead.deleteMany({ where: { email, publicCatalog: { shopId: shop.id } } }),
    prisma.wholesaleApplication.deleteMany({ where: { contactEmail: email, shopId: shop.id } }),
  ]);
  return buyers.count + offers.count + requests.count + leads.count + applications.count;
}

/**
 * customers/data_request: assemble EVERYTHING we hold on a customer for this
 * shop (same tables redact covers) so the merchant can fulfil the request. The
 * webhook handler is responsible for delivering this to the merchant.
 */
export async function collectCustomerData(
  shopDomain: string,
  customer: { email?: string | null },
) {
  const empty = { buyers: [], offers: [], quoteRequests: [], catalogLeads: [], wholesaleApplications: [] };
  if (!customer.email) return empty;
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return empty;
  const email = { equals: customer.email, mode: "insensitive" as const };

  const [buyers, offers, quoteRequests, catalogLeads, wholesaleApplications] = await Promise.all([
    prisma.buyer.findMany({ where: { email, company: { shopId: shop.id } }, include: { quotes: { include: { lines: true } } } }),
    prisma.offer.findMany({ where: { buyerEmail: email, shopId: shop.id } }),
    prisma.quoteRequest.findMany({ where: { email, shopId: shop.id } }),
    prisma.catalogLead.findMany({ where: { email, publicCatalog: { shopId: shop.id } } }),
    prisma.wholesaleApplication.findMany({ where: { contactEmail: email, shopId: shop.id } }),
  ]);
  return { buyers, offers, quoteRequests, catalogLeads, wholesaleApplications };
}

/**
 * Fulfil a customers/data_request: assemble the data and DELIVER it to the
 * merchant (who owns the obligation to the shopper) — never silently discard it.
 * Delivery is a best-effort email to the merchant alert address; an audit line
 * (counts only, no PII) is always logged so the request is provably handled.
 */
export async function deliverCustomerData(
  shopDomain: string,
  customer: { email?: string | null },
): Promise<void> {
  const data = await collectCustomerData(shopDomain, customer);
  const counts = {
    buyers: data.buyers.length,
    offers: data.offers.length,
    quoteRequests: data.quoteRequests.length,
    catalogLeads: data.catalogLeads.length,
    wholesaleApplications: data.wholesaleApplications.length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // Audit log: shop + counts only — never the customer's email or any PII.
  console.log(`[gdpr] customers/data_request handled for ${shopDomain}: ${total} record(s)`, counts);

  const to = process.env.MANNON_MERCHANT_ALERT_EMAIL;
  if (to && total > 0) {
    const dump = JSON.stringify(data, null, 2);
    const text =
      `A customer data request was received on ${shopDomain}.\n\n` +
      `Below is the data Mannon holds for this customer, so you can fulfil the request:\n\n${dump}`;
    try {
      await sendEmail({
        to,
        subject: `Customer data request — ${shopDomain}`,
        text,
        html: `<pre>${dump.replace(/[<>]/g, "")}</pre>`,
      });
    } catch (error) {
      captureException(error);
    }
  }
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
