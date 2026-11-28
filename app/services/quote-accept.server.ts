import type { Prisma } from "@prisma/client";
import { readAdjustments } from "../lib/quote-adjustments";
import prisma from "../db.server";
import { ensureBuyerCompanyLink } from "./buyer-link.server";
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
  createDraftOrderForQuote,
  DraftOrderError,
  type AdminGraphqlClient,
  type DraftOrderTotals,
} from "./draft-order.server";
import { evaluateCredit, getCreditProfile, outstandingForCompany, type CreditDecision } from "./credit.server";
import { isDemoEmail } from "./demo.server";
import { createInvoiceForOrder } from "./invoice.server";
import { featureAvailable, shopPlanHandle } from "../lib/plan-features";
import { emailQuoteOrdered } from "./quote-emails.server";
import { claimForOrder, releaseOrderClaim, QuoteAlreadyOrderedError } from "./order-claim.server";
import { readSnapshot } from "./quote-totals.server";

const CREDIT_ENABLED = () => process.env.MANNON_FF_CREDIT === "true";

/** Shopify's total changed since the quote was sent; the buyer confirms the new one. */
export class TotalsChangedError extends Error {
  constructor(
    public was: DraftOrderTotals,
    public now: DraftOrderTotals,
  ) {
    super("Shopify’s total for this order changed since the quote was sent.");
    this.name = "TotalsChangedError";
  }
}

// Equality only (no arithmetic): two amounts as Shopify wrote them.
const sameAmount = (a: string | null | undefined, b: string) => a != null && a.trim() !== "" && Number(a) === Number(b);
const totalsDiffer = (a: DraftOrderTotals, b: DraftOrderTotals) => a.currencyCode !== b.currencyCode || !sameAmount(a.total, b.total);

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
  options: {
    currencyCode: string;
    paymentTermsTemplateId?: string | null;
    /** The chosen template's type + net days, so Shopify gets the schedule it requires. */
    paymentTerm?: { paymentTermsType: string; dueInDays: number | null } | null;
    now?: Date;
    /**
     * The total the buyer confirmed after being told Shopify's total changed
     * since the quote was sent (TotalsChangedError). Shopify's new total must
     * match it, or the buyer is asked again.
     */
    confirmedTotal?: string | null;
  },
): Promise<{ quote: QuoteWithLines; totals: DraftOrderTotals }> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true, company: true, buyer: true },
  });
  if (!quote) throw new QuoteNotFoundError(quoteId);

  // Only a countered quote can be accepted. An ACCEPTED quote without a draft
  // order is an earlier attempt that stopped after Shopify (a failed save):
  // it resumes, and the draft order is found by its tag instead of recreated.
  const resuming = quote.status === "ACCEPTED" && !quote.draftOrderId;
  if (quote.status !== "COUNTERED" && !resuming) {
    if (quote.status === "ORDERED" || quote.draftOrderId) throw new QuoteAlreadyOrderedError();
    throw new IllegalQuoteTransitionError(quote.status, "ACCEPTED");
  }

  // One order per quote: claim it before calling Shopify (a second accept
  // stops here). Released below if anything before the order fails.
  const claim = await claimForOrder(quoteId, ["COUNTERED", "ACCEPTED"]);
  let totals: DraftOrderTotals;
  let ordered: QuoteWithLines;
  let draftOrderId: string;
  try {

    // The native purchasing entity, read from Shopify when the buyer isn't
    // linked yet (Customers → Companies owns it). Nothing is written to Shopify.
    const linked = await ensureBuyerCompanyLink(admin, quote.buyerId);
    if (!linked.ok) throw new DraftOrderError(linked.buyerMessage);

    // F9 — enforce order rules at conversion too, so a countered quote that no
    // longer meets MOQ/pack/min-value can't slip through. Round line quantities up
    // (persisted) and block a total under the store minimum.
    if (process.env.MANNON_FF_MOQ === "true") {
      const shop = await prisma.shop.findUnique({
        where: { id: quote.company.shopId },
        select: { shopifyDomain: true },
      });
      if (shop) {
        const { evaluateForCompany, logRuleApplied } = await import("./order-rules.server");
        const evalResult = await evaluateForCompany(
          shop.shopifyDomain,
          quote.lines.map((l) => ({ variantId: l.variantId, qty: l.quantity, price: Number(l.price) })),
          quote.companyId,
        );
        let changed = 0;
        for (const adj of evalResult.lines) {
          if (!adj.changed) continue;
          const line = quote.lines.find((l) => l.variantId === adj.variantId);
          if (line) {
            await prisma.quoteLine.update({ where: { id: line.id }, data: { quantity: adj.finalQty } });
            line.quantity = adj.finalQty;
            changed++;
          }
        }
        if (!evalResult.ok && evalResult.minOrderValue != null) {
          await logRuleApplied(quote.company.shopId, quoteId, { changed, blocked: true });
          throw new DraftOrderError(
            `This order is under the ${options.currencyCode} ${evalResult.minOrderValue.toFixed(2)} minimum. Add more before placing it.`,
          );
        }
        if (changed > 0) await logRuleApplied(quote.company.shopId, quoteId, { changed, blocked: false });
      }
    }

    // F14 — a verified-exempt buyer gets tax removed at checkout. We only set the
    // flag; Shopify zeroes the tax (we never compute it). Best-effort: a lookup
    // hiccup must never block the order, so it falls back to taxed.
    let taxExempt = false;
    if (process.env.MANNON_FF_TAX_VAT === "true") {
      try {
        const { isCompanyTaxExempt } = await import("./tax.server");
        taxExempt = await isCompanyTaxExempt(quote.companyId);
      } catch (error) {
        const { captureException } = await import("../lib/sentry.server");
        captureException(error);
      }
    }

    const input = buildDraftOrderInput({
      currencyCode: options.currencyCode,
      poReference: quote.poReference,
      paymentTermsTemplateId: options.paymentTermsTemplateId,
      paymentTerm: options.paymentTerm ?? null,
      now: options.now,
      taxExempt,
      purchasingEntity: linked.link,
      lines: quote.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        price: line.price.toString(),
      })),
      // The discount, shipping and custom items the buyer was sent.
      adjustments: readAdjustments(quote.adjustments),
    });

    // Shopify is the source of truth for money — preview first (we need the total
    // for the credit check before we create anything).
    const previewed = await calculateDraftOrder(admin, input);

    // The buyer agreed to the total Shopify calculated when the quote was sent.
    // If Shopify's total is different now (tax, a price or shipping changed),
    // ask the buyer to confirm the new total before creating the order.
    const sent = readSnapshot(quote.totalsSnapshot);
    if (sent && totalsDiffer(sent, previewed) && !sameAmount(options.confirmedTotal, previewed.total)) {
      throw new TotalsChangedError(sent, previewed);
    }

    // F2 — credit check (Growth-gated at the route; feature-flagged here). Block a
    // net-terms order that would breach the limit or a company on hold, BEFORE we
    // create the draft order, so nothing is stranded.
    if (CREDIT_ENABLED()) {
      const profile = await getCreditProfile(quote.companyId);
      if (profile) {
        const outstanding = await outstandingForCompany(
          quote.companyId,
          isDemoEmail(quote.buyer.email) ? { onlyBuyerId: quote.buyerId } : {},
        );
        const decision = evaluateCredit({
          status: profile.status,
          creditLimit: Number(profile.creditLimit),
          outstanding,
          newOrderAmount: Number(previewed.total),
        });
        if (!decision.allowed) throw new CreditBlockedError(decision);
      }
    }

    const created = await createDraftOrderForQuote(admin, quoteId, input);
    totals = created.totals ?? previewed;

    // Only now mutate quote state: COUNTERED → ACCEPTED → ORDERED.
    if (!resuming) await acceptQuote(quoteId, { now: options.now });
    ordered = await markOrdered(quoteId, {
      draftOrderId: created.id,
      totalsSnapshot: { ...totals, calculatedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      now: options.now,
    });
    draftOrderId = created.id;
  } catch (error) {
    // Nothing was created (or Shopify failed): let the buyer try again.
    await releaseOrderClaim(quoteId, claim);
    throw error;
  }
  await releaseOrderClaim(quoteId, claim);
  const created = { id: draftOrderId };

  await appendEvent({
    shopId: quote.company.shopId,
    type: "DRAFT_ORDER_CREATED",
    entityType: "Quote",
    entityId: quoteId,
    payload: { draftOrderId: created.id },
  });

  // F8 — accepting mid-cadence cancels the remaining nudges.
  if (process.env.MANNON_FF_FOLLOWUPS === "true") {
    try {
      const { cancelForQuote } = await import("./followups.server");
      await cancelForQuote(quoteId);
    } catch {
      /* self-heals on the next cron reconcile */
    }
  }

  // F2 — raise the net-terms invoice (dueDate = now + termsDays). Best-effort:
  // an invoice failure must not strand a placed order, so we swallow + report.
  // Net terms and credit are a Growth feature (owner decision, 27 Nov 2026): no
  // invoice below it, so no store is left with invoices it can't mark paid.
  const shopTerms = CREDIT_ENABLED()
    ? await prisma.shop.findUnique({
        where: { id: quote.company.shopId },
        select: { defaultTermsDays: true, plan: true, legacyPlan: true },
      })
    : null;
  if (CREDIT_ENABLED() && featureAvailable("netTerms", shopPlanHandle(shopTerms))) {
    try {
      const profile = await getCreditProfile(quote.companyId);
      const shop = shopTerms;
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

  // F15 — queue the placed order for outbound ERP export (best-effort; a sync
  // hiccup must never fail a placed order — it surfaces in the ERP sync log).
  if (process.env.MANNON_FF_ERP_SYNC === "true") {
    try {
      const { enqueueOrderExport } = await import("./erp.server");
      await enqueueOrderExport(quote.company.shopId, quoteId);
    } catch (error) {
      const { captureException } = await import("../lib/sentry.server");
      captureException(error);
    }
  }

  // Tell the buyer the order is placed (best-effort, logged against the quote).
  await emailQuoteOrdered(quoteId);

  return { quote: ordered, totals };
}
