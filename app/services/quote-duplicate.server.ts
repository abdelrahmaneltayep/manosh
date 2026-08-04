import prisma from "../db.server";
import { appendEvent } from "./events.server";

/**
 * F25.4 — "Create a similar quote". Clone an existing quote's line items + buyer +
 * notes into a fresh **editable draft** (status SUBMITTED) so a rep can replicate a
 * recurring request. The new quote carries `source = DUPLICATE` (feeds F23.4). We
 * copy the agreed line prices verbatim — the rep edits from there. Emits
 * QUOTE_DUPLICATED.
 */

export class QuoteNotFoundForShopError extends Error {
  constructor() {
    super("Quote not found.");
    this.name = "QuoteNotFoundForShopError";
  }
}

export async function duplicateQuote(shopDomain: string, quoteId: string, opts: { now?: Date } = {}): Promise<{ quoteId: string }> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true, quoteExpiryDays: true } });
  if (!shop) throw new QuoteNotFoundForShopError();

  const source = await prisma.quote.findFirst({
    where: { id: quoteId, company: { shopId: shop.id } },
    include: { lines: true },
  });
  if (!source) throw new QuoteNotFoundForShopError();

  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + shop.quoteExpiryDays * 24 * 60 * 60 * 1000);

  const created = await prisma.quote.create({
    data: {
      companyId: source.companyId,
      buyerId: source.buyerId,
      status: "SUBMITTED",
      source: "DUPLICATE",
      poReference: source.poReference,
      expiresAt,
      // Preserve the rep attribution so the copy stays with the same rep (F12).
      placedByRepId: source.placedByRepId,
      lines: {
        create: source.lines.map((l) => ({
          variantId: l.variantId,
          sku: l.sku,
          title: l.title,
          quantity: l.quantity,
          price: l.price,
        })),
      },
    },
    select: { id: true },
  });

  await appendEvent({
    shopId: shop.id,
    type: "QUOTE_DUPLICATED",
    entityType: "Quote",
    entityId: created.id,
    payload: { from: quoteId, lines: source.lines.length },
  });

  return { quoteId: created.id };
}
