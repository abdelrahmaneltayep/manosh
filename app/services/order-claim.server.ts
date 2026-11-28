import type { QuoteStatus } from "@prisma/client";
import prisma from "../db.server";

/**
 * One order per quote. Before Mannon asks Shopify to create a draft order it
 * claims the quote in a single conditional update; a second accept (a double
 * click, two tabs, or the buyer accepting while the merchant converts) finds
 * the claim and stops before calling Shopify. The claim is released if
 * Shopify fails, so the buyer can try again; a claim left by a crash expires
 * after CLAIM_STALE_MS.
 */
export const CLAIM_STALE_MS = 2 * 60_000;

export class OrderInProgressError extends Error {
  constructor() {
    super("This order is already being placed. Refresh in a moment to see it.");
    this.name = "OrderInProgressError";
  }
}

export class QuoteAlreadyOrderedError extends Error {
  constructor() {
    super("This quote is already an order.");
    this.name = "QuoteAlreadyOrderedError";
  }
}

/** Claim the quote for ordering, or throw why it can't be. Returns the claim stamp. */
export async function claimForOrder(quoteId: string, statuses: QuoteStatus[]): Promise<Date> {
  const stamp = new Date();
  const claimed = await prisma.quote.updateMany({
    where: {
      id: quoteId,
      status: { in: statuses },
      draftOrderId: null,
      convertedOrderId: null,
      OR: [{ orderingSince: null }, { orderingSince: { lt: new Date(stamp.getTime() - CLAIM_STALE_MS) } }],
    },
    data: { orderingSince: stamp },
  });
  if (claimed.count === 1) return stamp;
  const now = await prisma.quote.findUnique({ where: { id: quoteId }, select: { draftOrderId: true, convertedOrderId: true, status: true } });
  if (now?.draftOrderId || now?.convertedOrderId || now?.status === "ORDERED") throw new QuoteAlreadyOrderedError();
  throw new OrderInProgressError();
}

/** Let go of a claim (Shopify failed, or the order is in place). Only our own claim. */
export async function releaseOrderClaim(quoteId: string, stamp: Date): Promise<void> {
  await prisma.quote.updateMany({ where: { id: quoteId, orderingSince: stamp }, data: { orderingSince: null } });
}
