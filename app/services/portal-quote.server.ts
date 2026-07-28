import prisma from "../db.server";
import type { CatalogItem } from "./catalog.server";
import { submitQuote, type QuoteLineInput, type QuoteWithLines } from "./quote.server";
import { canCreateQuote } from "./plan-limits.server";
import { QUOTE_CAP_BUYER_MESSAGE } from "../lib/billing";

/**
 * Buyer-portal quote submission (F1). Turns a buyer's basket of catalog
 * selections into a SUBMITTED quote. Line details (title, sku, price) are
 * resolved from the SERVER catalog, never trusted from the client — a
 * selection whose variant isn't in the catalog is rejected.
 */

export interface QuoteSelection {
  variantId: string;
  quantity: number;
}

/** Parse `quantity_<variantId>` form fields into selections (qty > 0 only). */
export function parseQuoteSelections(form: FormData): QuoteSelection[] {
  const selections: QuoteSelection[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("quantity_")) continue;
    const quantity = Number(value);
    if (Number.isInteger(quantity) && quantity > 0) {
      selections.push({ variantId: key.slice("quantity_".length), quantity });
    }
  }
  return selections;
}

export type BuildLinesResult =
  | { ok: true; lines: QuoteLineInput[] }
  | { ok: false; error: string };

/** Resolve selections against the catalog into quote lines. */
export function buildQuoteLinesFromSelections(
  catalog: CatalogItem[],
  selections: QuoteSelection[],
): BuildLinesResult {
  if (selections.length === 0) {
    return { ok: false, error: "Add at least one product to request a quote." };
  }
  const byVariant = new Map(catalog.map((item) => [item.variantId, item]));
  const lines: QuoteLineInput[] = [];

  for (const selection of selections) {
    if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
      return { ok: false, error: "Quantities must be whole numbers of 1 or more." };
    }
    const item = byVariant.get(selection.variantId);
    if (!item) {
      return {
        ok: false,
        error: "One of the selected products is no longer available. Refresh and try again.",
      };
    }
    lines.push({
      variantId: item.variantId,
      sku: item.sku,
      title: item.displayTitle,
      quantity: selection.quantity,
      price: item.price,
    });
  }

  return { ok: true, lines };
}

export type SubmitBuyerQuoteResult =
  | { ok: true; quote: QuoteWithLines }
  | { ok: false; error: string; capReached?: boolean };

export async function submitBuyerQuote(
  buyer: { id: string; companyId: string },
  selections: QuoteSelection[],
  catalog: CatalogItem[],
  options: { placedByRepId?: string | null } = {},
): Promise<SubmitBuyerQuoteResult> {
  const built = buildQuoteLinesFromSelections(catalog, selections);
  if (!built.ok) return built;

  // Plan quote-volume cap (per shop). Check before persisting.
  const company = await prisma.company.findUnique({
    where: { id: buyer.companyId },
    select: { shopId: true, shop: { select: { shopifyDomain: true } } },
  });
  if (company) {
    const allowance = await canCreateQuote(company.shopId);
    if (!allowance.allowed) {
      return { ok: false, error: QUOTE_CAP_BUYER_MESSAGE, capReached: true };
    }
  }

  // F9 — order rules (MOQ / pack size / min order value). Round line quantities
  // up (never dropped) and block a cart under the store minimum with a shortfall.
  if (process.env.MANNON_FF_MOQ === "true" && company) {
    const { evaluateForCompany } = await import("./order-rules.server");
    const evalResult = await evaluateForCompany(
      company.shop.shopifyDomain,
      built.lines.map((l) => ({ variantId: l.variantId, qty: l.quantity, price: Number(l.price) })),
      buyer.companyId,
    );
    for (const adj of evalResult.lines) {
      const line = built.lines.find((l) => l.variantId === adj.variantId);
      if (line) line.quantity = adj.finalQty;
    }
    if (!evalResult.ok && evalResult.minOrderValue != null) {
      const { shortfallMessage } = await import("../lib/order-rules");
      const currency = catalog[0]?.currencyCode ?? "USD";
      return { ok: false, error: shortfallMessage(currency, evalResult.shortfall, evalResult.minOrderValue) };
    }
  }

  // F15 — oversell guard: block a line whose quantity exceeds ERP-known stock
  // before it becomes a quote/order. No signal → allowed; flag off → allowed.
  if (process.env.MANNON_FF_ERP_SYNC === "true" && company) {
    try {
      const { checkStockForCart } = await import("./erp.server");
      const stock = await checkStockForCart(company.shop.shopifyDomain, built.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, sku: l.sku })));
      if (!stock.ok) return { ok: false, error: stock.message ?? "One or more items are out of stock." };
    } catch {
      /* stock guard is best-effort — never hard-block on a lookup error */
    }
  }

  // F16 — lock the buyer's display currency + FX rate at issue time so a later
  // counter-offer never drifts with FX. Flag off → base currency, rate 1.
  let displayCurrency: string | null = null;
  let displayRate: string | null = null;
  if (process.env.MANNON_FF_I18N === "true" && company) {
    try {
      const { resolveLockedFx } = await import("./i18n.server");
      const fx = await resolveLockedFx(company.shop.shopifyDomain, { companyId: buyer.companyId, memberId: buyer.id });
      displayCurrency = fx.currency;
      displayRate = fx.rate;
    } catch {
      /* fall back to store currency — never block a quote on FX resolution */
    }
  }

  const quote = await submitQuote({
    companyId: buyer.companyId,
    buyerId: buyer.id,
    lines: built.lines,
    placedByRepId: options.placedByRepId ?? null,
    displayCurrency,
    displayRate,
  });

  // F8 — schedule automated follow-ups (feature-flagged; no-op if the policy is
  // off). Best-effort: a scheduling hiccup must never fail the quote.
  if (process.env.MANNON_FF_FOLLOWUPS === "true") {
    try {
      const { scheduleForQuote } = await import("./followups.server");
      await scheduleForQuote(quote.id);
    } catch {
      /* self-heals on the next cron reconcile */
    }
  }

  return { ok: true, quote };
}
