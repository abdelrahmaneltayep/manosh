import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import {
  acceptQuote,
  markOrdered,
  IllegalQuoteTransitionError,
  QuoteNotFoundError,
  type QuoteWithLines,
} from "./quote.server";
import {
  buildDraftOrderInput,
  calculateDraftOrder,
  createDraftOrder,
  DraftOrderError,
  type AdminGraphqlClient,
  type DraftOrderTotals,
} from "./draft-order.server";

/**
 * Accept a countered quote and turn it into a Shopify draft order (S8).
 *
 * Order of operations is deliberate: we call Shopify FIRST (calculate → create),
 * then transition the quote (COUNTERED → ACCEPTED → ORDERED). So if Shopify
 * fails, the quote stays cleanly COUNTERED and the buyer can retry — we never
 * strand a quote in ACCEPTED with no order. Totals are Shopify's response,
 * snapshotted verbatim; we compute nothing.
 */
export async function acceptAndOrder(
  quoteId: string,
  admin: AdminGraphqlClient,
  options: { currencyCode: string; now?: Date },
): Promise<{ quote: QuoteWithLines; totals: DraftOrderTotals }> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true, company: true, buyer: true },
  });
  if (!quote) throw new QuoteNotFoundError(quoteId);

  // Only a countered quote can be accepted.
  if (quote.status !== "COUNTERED") {
    throw new IllegalQuoteTransitionError(quote.status, "ACCEPTED");
  }

  const companyLocationId = quote.buyer.shopifyCompanyLocationId;
  if (!companyLocationId) {
    throw new DraftOrderError(
      "This buyer isn’t linked to a company location yet, so an order can’t be created.",
    );
  }

  const input = buildDraftOrderInput({
    currencyCode: options.currencyCode,
    poReference: quote.poReference,
    purchasingEntity: {
      companyId: quote.company.shopifyCompanyId,
      companyLocationId,
      companyContactId: quote.buyer.shopifyContactId,
    },
    lines: quote.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      price: line.price.toString(),
    })),
  });

  // Shopify is the source of truth for money — preview, then create.
  const previewed = await calculateDraftOrder(admin, input);
  const created = await createDraftOrder(admin, input);
  const totals = created.totals ?? previewed;

  // Only now mutate quote state: COUNTERED → ACCEPTED → ORDERED.
  await acceptQuote(quoteId, { now: options.now });
  const ordered = await markOrdered(quoteId, {
    draftOrderId: created.id,
    totalsSnapshot: totals as unknown as Prisma.InputJsonValue,
    now: options.now,
  });

  await appendEvent({
    shopId: quote.company.shopId,
    type: "DRAFT_ORDER_CREATED",
    entityType: "Quote",
    entityId: quoteId,
    payload: { draftOrderId: created.id },
  });

  return { quote: ordered, totals };
}
