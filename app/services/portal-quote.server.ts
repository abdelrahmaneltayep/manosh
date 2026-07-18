import type { CatalogItem } from "./catalog.server";
import { submitQuote, type QuoteLineInput, type QuoteWithLines } from "./quote.server";

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
  | { ok: false; error: string };

export async function submitBuyerQuote(
  buyer: { id: string; companyId: string },
  selections: QuoteSelection[],
  catalog: CatalogItem[],
): Promise<SubmitBuyerQuoteResult> {
  const built = buildQuoteLinesFromSelections(catalog, selections);
  if (!built.ok) return built;

  const quote = await submitQuote({
    companyId: buyer.companyId,
    buyerId: buyer.id,
    lines: built.lines,
  });
  return { ok: true, quote };
}
