import prisma from "../db.server";
import { captureException } from "../lib/sentry.server";
import { isPositivePrice, sendBlockedReason, type QuoteAdjustments } from "../lib/quote-adjustments";
import { ensureBuyerCompanyLink } from "./buyer-link.server";
import {
  buildDraftOrderInput,
  calculateDraftOrder,
  DraftOrderError,
  type AdminGraphqlClient,
  type DraftOrderTotals,
} from "./draft-order.server";
import { counterQuote, type CounterLineInput } from "./quote.server";

/**
 * Send a quote (Phase 3, draft-order layout). In order:
 *   1. refuse an expired or already-sent quote;
 *   2. refuse any line or custom item priced at 0 or below;
 *   3. ask Shopify to calculate the totals for exactly what will be sent
 *      (lines, discount, shipping, custom items) — if Shopify can't, nothing
 *      is saved and nothing is sent;
 *   4. save the prices, adjustments, message and Shopify's totals together
 *      with the status change, in one transaction.
 * The app never adds anything up: the totals stored are Shopify's.
 */
export type SendQuoteResult =
  | { ok: true; totals: DraftOrderTotals }
  | { ok: false; error: string; reason: "not-found" | "blocked" | "price" | "shopify" };

export async function sendQuoteForShop(params: {
  shopDomain: string;
  quoteId: string;
  admin: AdminGraphqlClient;
  currencyCode: string;
  lines: CounterLineInput[];
  adjustments: QuoteAdjustments;
  buyerMessage: string | null;
  now?: Date;
}): Promise<SendQuoteResult> {
  const quote = await prisma.quote.findFirst({
    where: { id: params.quoteId, company: { shop: { shopifyDomain: params.shopDomain } } },
    include: { lines: true },
  });
  if (!quote) return { ok: false, reason: "not-found", error: "This quote couldn’t be found." };

  const blocked = sendBlockedReason({ status: quote.status, expiresAt: quote.expiresAt, now: params.now });
  if (blocked) return { ok: false, reason: "blocked", error: blocked };

  // The prices that will be sent: the edits, else what's stored.
  const edits = new Map(params.lines.filter((l) => quote.lines.some((q) => q.id === l.id)).map((l) => [l.id, l]));
  const final = quote.lines.map((line) => ({
    line,
    price: edits.get(line.id)?.price ?? line.price.toString(),
    quantity: edits.get(line.id)?.quantity ?? line.quantity,
  }));
  if (final.length === 0 && params.adjustments.customItems.length === 0) {
    return { ok: false, reason: "price", error: "Add at least one item before sending." };
  }
  const zero = final.find((f) => !(Number(f.price) > 0));
  if (zero) return { ok: false, reason: "price", error: `Set a price above 0 for “${zero.line.title}” before sending.` };
  const zeroCustom = params.adjustments.customItems.find((c) => !isPositivePrice(c.price));
  if (zeroCustom) return { ok: false, reason: "price", error: `Set a price above 0 for “${zeroCustom.title}” before sending.` };

  // Shopify calculates the totals for exactly what is about to be sent.
  const linked = await ensureBuyerCompanyLink(params.admin, quote.buyerId);
  if (!linked.ok) {
    return { ok: false, reason: "shopify", error: `Shopify can’t calculate this quote’s totals yet, so it wasn’t sent. ${linked.merchantMessage}` };
  }
  let totals: DraftOrderTotals;
  try {
    totals = await calculateDraftOrder(
      params.admin,
      buildDraftOrderInput({
        currencyCode: params.currencyCode,
        poReference: quote.poReference,
        purchasingEntity: linked.link,
        lines: final.map((f) => ({ variantId: f.line.variantId, quantity: f.quantity, price: f.price })),
        adjustments: params.adjustments,
      }),
    );
  } catch (error) {
    if (error instanceof DraftOrderError) {
      return { ok: false, reason: "shopify", error: `Shopify couldn’t calculate the totals, so the quote wasn’t sent: ${error.message.replace(/^draftOrderCalculate failed: /, "")}` };
    }
    captureException(error);
    return { ok: false, reason: "shopify", error: "Shopify couldn’t be reached to calculate the totals, so the quote wasn’t sent. Try again in a moment." };
  }

  await counterQuote(quote.id, {
    lines: params.lines,
    now: params.now,
    data: {
      adjustments: params.adjustments as object,
      buyerMessage: params.buyerMessage,
      totalsSnapshot: { ...totals, calculatedAt: new Date().toISOString() } as object,
    },
  });
  return { ok: true, totals };
}

/** Save the merchant-only note. Never shown to the buyer. */
export async function saveInternalNote(shopDomain: string, quoteId: string, note: string): Promise<boolean> {
  const text = note.replace(/\r\n/g, "\n").trim().slice(0, 5000);
  const updated = await prisma.quote.updateMany({
    where: { id: quoteId, company: { shop: { shopifyDomain: shopDomain } } },
    data: { internalNote: text || null },
  });
  return updated.count === 1;
}

/** The quote's events and emails for its timeline (newest first, capped). */
export async function quoteTimelineSources(shopId: string, quoteId: string) {
  const [events, emails] = await Promise.all([
    prisma.event.findMany({
      where: { shopId, entityType: "Quote", entityId: quoteId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { type: true, createdAt: true, payload: true },
    }),
    prisma.emailDelivery.findMany({
      where: { shopId, entityType: "Quote", entityId: quoteId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { to: true, template: true, status: true, error: true, createdAt: true },
    }),
  ]);
  return { events, emails };
}
