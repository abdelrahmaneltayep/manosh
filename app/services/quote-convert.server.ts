import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { acceptQuote, markOrdered } from "./quote.server";
import {
  buildDraftOrderInput,
  createDraftOrder,
  sendDraftOrderInvoice,
  DraftOrderError,
  type AdminGraphqlClient,
  type DraftOrderTotals,
} from "./draft-order.server";

/**
 * F25.2 — merchant one-click convert: an ACCEPTED quote → a native Shopify draft
 * order at the buyer's **exact negotiated prices**, then email the invoice. We
 * reuse the S8 draft-order builder (no second pricing brain) and take line prices
 * verbatim from the quote — we NEVER re-price from the live catalog. Order of
 * operations mirrors S8: Shopify first, then flip the quote to ORDERED +
 * convertedOrderId, so a Shopify failure never strands the quote.
 *
 * The invoice send is best-effort: the order exists regardless, and Shopify owns
 * the email + hosted invoice link. Net-terms / deposit / pay-by-link continue to
 * flow through F2 / F13 on the created order.
 */

export class QuoteConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteConvertError";
  }
}

export interface ConvertQuoteResult {
  orderId: string;
  totals: DraftOrderTotals;
  invoiceSent: boolean;
}

export async function convertQuoteToOrder(
  quoteId: string,
  admin: AdminGraphqlClient,
  opts: { currencyCode: string; paymentTermsTemplateId?: string | null; now?: Date; sendInvoice?: boolean },
): Promise<ConvertQuoteResult> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true, company: true, buyer: true },
  });
  if (!quote) throw new QuoteConvertError("Quote not found.");
  // A merchant converts an ACCEPTED quote, or a COUNTERED one the buyer has agreed
  // to offline (we accept it on their behalf first). SUBMITTED/EXPIRED can't convert.
  if (quote.status !== "ACCEPTED" && quote.status !== "COUNTERED") {
    throw new QuoteConvertError("Only an accepted or countered quote can be converted to an order.");
  }
  if (quote.convertedOrderId || quote.draftOrderId) throw new QuoteConvertError("This quote is already an order.");
  if (quote.lines.length === 0) throw new QuoteConvertError("This quote has no line items.");

  const companyLocationId = quote.buyer.shopifyCompanyLocationId;
  if (!companyLocationId) {
    throw new QuoteConvertError("This buyer isn’t linked to a company location yet, so an order can’t be created.");
  }

  // Build from the quote's lines with the AGREED prices, verbatim. price.toString()
  // is the negotiated unit price — Shopify calculates tax + totals on top.
  const input = buildDraftOrderInput({
    currencyCode: opts.currencyCode,
    poReference: quote.poReference,
    paymentTermsTemplateId: opts.paymentTermsTemplateId,
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

  // Shopify FIRST (source of truth for money) — then mutate quote state.
  const created = await createDraftOrder(admin, input);

  // Best-effort invoice email (the order stands even if the send hiccups).
  let invoiceSent = false;
  if (opts.sendInvoice !== false) {
    try {
      await sendDraftOrderInvoice(admin, created.id);
      invoiceSent = true;
    } catch (error) {
      if (!(error instanceof DraftOrderError)) throw error;
      const { captureException } = await import("../lib/sentry.server");
      captureException(error);
    }
  }

  // COUNTERED → ACCEPTED → ORDERED (the buyer-accept path's two steps), or straight
  // ACCEPTED → ORDERED. Only now that Shopify has the order do we mutate state.
  if (quote.status === "COUNTERED") await acceptQuote(quoteId, { now: opts.now });
  await markOrdered(quoteId, {
    draftOrderId: created.id,
    totalsSnapshot: created.totals as unknown as Prisma.InputJsonValue,
    now: opts.now,
  });
  await prisma.quote.update({ where: { id: quoteId }, data: { convertedOrderId: created.id } });

  await appendEvent({
    shopId: quote.company.shopId,
    type: "QUOTE_CONVERTED",
    entityType: "Quote",
    entityId: quoteId,
    payload: { orderId: created.id, invoiceSent },
  });

  return { orderId: created.id, totals: created.totals, invoiceSent };
}
