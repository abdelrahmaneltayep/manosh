import prisma from "../db.server";
import { issueMagicLink } from "./magic-link.server";

/**
 * A sign-in link for the buyer on one quote, for the merchant to copy and send
 * themselves while Mannon has no email sender connected. The link signs the
 * buyer in and lands on that quote.
 *
 * It is an ordinary sign-in link: single use, expires per the shop's setting,
 * stored only as a hash. Links made earlier for the same buyer keep working. Scoped to the shop: null when the quote isn't theirs.
 */
export async function issueBuyerQuoteLink(
  shopDomain: string,
  quoteId: string,
  baseUrl: string,
  now: Date = new Date(),
): Promise<{ url: string; expiresAt: Date; buyerEmail: string; buyerName: string | null } | null> {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, company: { shop: { shopifyDomain: shopDomain } } },
    select: { id: true, buyer: { select: { id: true, email: true, name: true } } },
  });
  if (!quote) return null;
  const { url, expiresAt } = await issueMagicLink(quote.buyer.id, {
    baseUrl,
    now,
    next: `/portal/quotes/${quote.id}`,
  });
  return { url, expiresAt, buyerEmail: quote.buyer.email, buyerName: quote.buyer.name };
}
