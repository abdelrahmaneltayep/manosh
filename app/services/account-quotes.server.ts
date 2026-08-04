import type { QuoteStatus, QuoteSource } from "@prisma/client";
import prisma from "../db.server";

/**
 * F25.5 — read-only quote list for the buyer's **native customer account** (the
 * Customer Account UI extension). No mutations here: the extension shows the
 * buyer's quotes + status and deep-links to the magic-link portal for anything
 * that acts (reorder, request a similar quote). Scoped to a buyer email within
 * one shop.
 */

export interface AccountQuote {
  id: string;
  status: QuoteStatus;
  source: QuoteSource;
  createdAt: Date;
  itemCount: number;
  /** Estimated total from the agreed line prices (tax/final total are Shopify's). */
  estimatedTotal: number;
  displayCurrency: string | null;
  /** True when the quote became an order and can be reordered. */
  reorderable: boolean;
}

export async function listQuotesForBuyer(shopDomain: string, email: string): Promise<AccountQuote[]> {
  const clean = email.trim().toLowerCase();
  if (!clean) return [];
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return [];

  const quotes = await prisma.quote.findMany({
    where: { buyer: { email: clean }, company: { shopId: shop.id } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { lines: { select: { quantity: true, price: true } } },
  });

  return quotes.map((q) => ({
    id: q.id,
    status: q.status,
    source: q.source,
    createdAt: q.createdAt,
    itemCount: q.lines.length,
    estimatedTotal: q.lines.reduce((s, l) => s + l.quantity * Number(l.price), 0),
    displayCurrency: q.displayCurrency,
    reorderable: q.status === "ORDERED" && (q.draftOrderId != null || q.convertedOrderId != null),
  }));
}
