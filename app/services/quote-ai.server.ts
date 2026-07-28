import type { QuoteAiSuggestion } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { getVariantCost } from "./variant-cost.server";
import {
  QUOTE_ASSISTANT_MODEL,
  suggestCounterOffer,
  type QuoteSuggestion,
  type SuggestInvoke,
} from "./ai/quote-assistant.server";

/**
 * DB-touching orchestration for Feature 1 (AI Quote Assistant). Assembles the
 * model context (line, cost, tier, history + the shop's floor margin), calls the
 * pure suggestion service, persists the result, and appends the funnel event.
 * Ownership-scoped: a merchant can only ever act on their own quotes.
 *
 * Rate-limited (in-memory, per shop) so a merchant clicking fast can't fan out
 * expensive model calls. The last suggestion is cached in the DB and reused by
 * the page loader.
 */

/** Minimum gap between model calls for a shop. */
export const AI_RATE_LIMIT_MS = 1500;

/** Pure: is a new call allowed given the last call time? */
export function rateLimitOk(
  lastTs: number | undefined,
  now: number,
  minMs: number = AI_RATE_LIMIT_MS,
): boolean {
  return lastTs === undefined || now - lastTs >= minMs;
}

export class AiRateLimitedError extends Error {
  constructor() {
    super("Please wait a moment before asking for another suggestion.");
    this.name = "AiRateLimitedError";
  }
}
export class QuoteLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Quote line not found: ${id}`);
    this.name = "QuoteLineNotFoundError";
  }
}

const lastCallAt = new Map<string, number>();

/** Test helper: reset the in-memory rate-limit state. */
export function resetAiRateLimit(): void {
  lastCallAt.clear();
}

export interface GenerateOptions {
  invoke?: SuggestInvoke;
  now?: number;
  /** Injected cost lookup for tests. */
  costLoader?: typeof getVariantCost;
}

export interface StoredSuggestion extends QuoteSuggestion {
  id: string;
  lineId: string;
  createdAt: Date;
}

/** Load the quote (ownership-scoped) with lines + company, or null. */
async function loadOwnedQuote(shopDomain: string, quoteId: string) {
  return prisma.quote.findFirst({
    where: { id: quoteId, company: { shop: { shopifyDomain: shopDomain } } },
    include: { lines: true, company: true },
  });
}

/** Short, PII-free prior-quote history for the company (most recent first). */
async function recentHistory(companyId: string, excludeQuoteId: string): Promise<string[]> {
  const prior = await prisma.quote.findMany({
    where: { companyId, id: { not: excludeQuoteId } },
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { _count: { select: { lines: true } } },
  });
  return prior.map(
    (q) =>
      `${q.createdAt.toISOString().slice(0, 10)}: ${q.status}, ${q._count.lines} line(s)`,
  );
}

/**
 * Generate + persist a suggestion for one line. Rate-limited per shop. Emits
 * AI_SUGGESTION_USED. Returns the stored suggestion.
 */
export async function generateSuggestionForLine(
  shopDomain: string,
  quoteId: string,
  lineId: string,
  options: GenerateOptions = {},
): Promise<StoredSuggestion> {
  const now = options.now ?? Date.now();
  if (!rateLimitOk(lastCallAt.get(shopDomain), now)) {
    throw new AiRateLimitedError();
  }

  const quote = await loadOwnedQuote(shopDomain, quoteId);
  if (!quote) throw new QuoteLineNotFoundError(lineId);
  const line = quote.lines.find((l) => l.id === lineId);
  if (!line) throw new QuoteLineNotFoundError(lineId);

  lastCallAt.set(shopDomain, now);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { minMarginPct: true },
  });
  const minMarginPct = shop?.minMarginPct ?? 0.15;

  const costLoader = options.costLoader ?? getVariantCost;
  const cost = await costLoader(shopDomain, line.variantId);
  const history = await recentHistory(quote.companyId, quoteId);

  const suggestion = await suggestCounterOffer(
    {
      productTitle: line.title,
      sku: line.sku,
      requestedQty: line.quantity,
      listPrice: Number(line.price),
      costPrice: cost.costPrice,
      currencyCode: cost.currencyCode ?? "USD",
      customerTier: null,
      quoteHistory: history,
      minMarginPct,
    },
    { invoke: options.invoke },
  );

  const row = await prisma.quoteAiSuggestion.create({
    data: {
      quoteId,
      lineId,
      suggestedPrice: suggestion.suggestedPrice.toFixed(4),
      floorPrice: (suggestion.floorPrice ?? 0).toFixed(4),
      marginPct: suggestion.marginPct,
      belowFloor: suggestion.belowFloor,
      rationale: suggestion.rationale,
      draftMessage: suggestion.draftMessage,
      model: suggestion.model ?? QUOTE_ASSISTANT_MODEL,
    },
  });

  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (shopRow) {
    // ids + numbers only — no PII (guardrail #6).
    await appendEvent({
      shopId: shopRow.id,
      type: "AI_SUGGESTION_USED",
      entityType: "Quote",
      entityId: quoteId,
      payload: {
        lineId,
        belowFloor: suggestion.belowFloor,
        marginPct: suggestion.marginPct ?? null,
      },
    });
  }

  return { ...suggestion, id: row.id, lineId, createdAt: row.createdAt };
}

/** Generate suggestions for every line on a quote (the quote-level action). */
export async function generateSuggestionsForQuote(
  shopDomain: string,
  quoteId: string,
  options: GenerateOptions = {},
): Promise<StoredSuggestion[]> {
  const quote = await loadOwnedQuote(shopDomain, quoteId);
  if (!quote) throw new QuoteLineNotFoundError(quoteId);
  const out: StoredSuggestion[] = [];
  for (const line of quote.lines) {
    // Sequential so the per-shop rate limit and cost cache behave predictably.
    out.push(
      await generateSuggestionForLine(shopDomain, quoteId, line.id, {
        ...options,
        // advance the clock a touch so the rate limit doesn't trip on the loop
        now: (options.now ?? Date.now()) + out.length * AI_RATE_LIMIT_MS,
      }),
    );
  }
  return out;
}

export interface SuggestionView {
  id: string;
  lineId: string | null;
  suggestedPrice: string;
  floorPrice: string;
  marginPct: number | null;
  belowFloor: boolean;
  rationale: string;
  draftMessage: string;
  model: string;
  createdAt: Date;
}

/** Latest suggestion per line for a quote (the cached view for the page). */
export async function getLatestSuggestions(
  quoteId: string,
): Promise<Map<string, SuggestionView>> {
  const rows = await prisma.quoteAiSuggestion.findMany({
    where: { quoteId },
    orderBy: { createdAt: "desc" },
  });
  const byLine = new Map<string, SuggestionView>();
  for (const r of rows) {
    const key = r.lineId ?? "__quote__";
    if (byLine.has(key)) continue; // first = most recent
    byLine.set(key, toView(r));
  }
  return byLine;
}

function toView(r: QuoteAiSuggestion): SuggestionView {
  return {
    id: r.id,
    lineId: r.lineId,
    suggestedPrice: r.suggestedPrice.toString(),
    floorPrice: r.floorPrice.toString(),
    marginPct: r.marginPct,
    belowFloor: r.belowFloor,
    rationale: r.rationale,
    draftMessage: r.draftMessage,
    model: r.model,
    createdAt: r.createdAt,
  };
}
