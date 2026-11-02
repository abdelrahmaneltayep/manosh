import prisma from "../db.server";
import {
  buildDraftOrderInput,
  calculateDraftOrder,
  DraftOrderError,
  type AdminGraphqlClient,
  type DraftOrderTotals,
} from "./draft-order.server";
import type { CounterLineInput } from "./quote.server";

/**
 * Shopify's subtotal, tax and total for a quote, for the merchant's quote page
 * (live QA TC2). Never computes money (guardrail #1): an ordered quote shows the
 * snapshot taken from Shopify at order time, anything else is priced by
 * `draftOrderCalculate` for the buyer's company location. Nothing is created or
 * saved here, so the merchant can preview a counter before sending it.
 */
export type QuoteTotalsPreview =
  | { ok: true; totals: DraftOrderTotals; source: "snapshot" | "calculated" }
  | { ok: false; message: string };

export async function previewQuoteTotals(params: {
  shopDomain: string;
  quoteId: string;
  admin: AdminGraphqlClient;
  currencyCode: string;
  /** Unsaved counter edits (from the counter form) to price instead of the stored lines. */
  edits?: CounterLineInput[];
}): Promise<QuoteTotalsPreview> {
  const quote = await prisma.quote.findFirst({
    where: { id: params.quoteId, company: { shop: { shopifyDomain: params.shopDomain } } },
    include: { lines: true, company: true, buyer: true },
  });
  if (!quote) return { ok: false, message: "This quote couldn’t be found." };

  const snapshot = readSnapshot(quote.totalsSnapshot);
  if (snapshot && !params.edits) return { ok: true, totals: snapshot, source: "snapshot" };

  const companyLocationId = quote.buyer.shopifyCompanyLocationId;
  const companyContactId = quote.buyer.shopifyContactId;
  if (!companyLocationId || !companyContactId) {
    return {
      ok: false,
      message:
        "Shopify can’t price this quote yet: the buyer isn’t linked to a company location and contact. Link them in Customers → Companies.",
    };
  }
  if (quote.lines.length === 0) return { ok: false, message: "This quote has no line items." };

  const edits = new Map((params.edits ?? []).map((e) => [e.id, e]));
  const input = buildDraftOrderInput({
    currencyCode: params.currencyCode,
    poReference: quote.poReference,
    purchasingEntity: { companyId: quote.company.shopifyCompanyId, companyLocationId, companyContactId },
    lines: quote.lines.map((line) => ({
      variantId: line.variantId,
      quantity: edits.get(line.id)?.quantity ?? line.quantity,
      price: edits.get(line.id)?.price ?? line.price.toString(),
    })),
  });

  try {
    return { ok: true, totals: await calculateDraftOrder(params.admin, input), source: "calculated" };
  } catch (error) {
    if (error instanceof DraftOrderError) {
      return { ok: false, message: `Shopify couldn’t price this quote: ${error.message.replace(/^draftOrderCalculate failed: /, "")}` };
    }
    console.error("[quote-totals] preview failed for quote %s:", params.quoteId, error);
    const { captureException } = await import("../lib/sentry.server");
    captureException(error);
    return { ok: false, message: "Shopify’s totals aren’t available right now. Try again in a moment." };
  }
}

/** A stored Shopify totals snapshot, or null when there isn't a complete one. Pure. */
export function readSnapshot(value: unknown): DraftOrderTotals | null {
  const s = value as Partial<DraftOrderTotals> | null | undefined;
  if (!s || typeof s !== "object") return null;
  if (typeof s.subtotal !== "string" || typeof s.totalTax !== "string" || typeof s.total !== "string") return null;
  return { subtotal: s.subtotal, totalTax: s.totalTax, total: s.total, currencyCode: s.currencyCode || "USD" };
}
