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
import { evaluateCredit, getCreditProfile, outstandingForCompany, type CreditDecision } from "./credit.server";
import { createInvoiceForOrder } from "./invoice.server";

const CREDIT_ENABLED = () => process.env.MANNON_FF_CREDIT === "true";

/**
 * Thrown when a net-terms order would breach the company's credit limit or the
 * company is on hold. The buyer sees a plain-language "needs approval" message;
 * the merchant lifts it by raising the limit / clearing the hold (logged).
 */
export class CreditBlockedError extends Error {
  decision: CreditDecision;
  constructor(decision: CreditDecision) {
    super("This order needs approval from the store before it can be placed on terms.");
    this.name = "CreditBlockedError";
    this.decision = decision;
  }
}

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
  options: { currencyCode: string; paymentTermsTemplateId?: string | null; now?: Date },
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
    paymentTermsTemplateId: options.paymentTermsTemplateId,
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

  // Shopify is the source of truth for money — preview first (we need the total
  // for the credit check before we create anything).
  const previewed = await calculateDraftOrder(admin, input);

  // F2 — credit check (Growth-gated at the route; feature-flagged here). Block a
  // net-terms order that would breach the limit or a company on hold, BEFORE we
  // create the draft order, so nothing is stranded.
  if (CREDIT_ENABLED()) {
    const profile = await getCreditProfile(quote.companyId);
    if (profile) {
      const outstanding = await outstandingForCompany(quote.companyId);
      const decision = evaluateCredit({
        status: profile.status,
        creditLimit: Number(profile.creditLimit),
        outstanding,
        newOrderAmount: Number(previewed.total),
      });
      if (!decision.allowed) throw new CreditBlockedError(decision);
    }
  }

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

  // F2 — raise the net-terms invoice (dueDate = now + termsDays). Best-effort:
  // an invoice failure must not strand a placed order, so we swallow + report.
  if (CREDIT_ENABLED()) {
    try {
      const profile = await getCreditProfile(quote.companyId);
      const shop = await prisma.shop.findUnique({
        where: { id: quote.company.shopId },
        select: { defaultTermsDays: true },
      });
      const termsDays = profile?.termsDays ?? shop?.defaultTermsDays ?? 30;
      await createInvoiceForOrder({
        companyId: quote.companyId,
        shopId: quote.company.shopId,
        quoteId,
        orderId: created.id,
        amount: totals.total,
        currency: totals.currencyCode,
        termsDays,
        now: options.now,
      });
    } catch (error) {
      const { captureException } = await import("../lib/sentry.server");
      captureException(error);
    }
  }

  return { quote: ordered, totals };
}
