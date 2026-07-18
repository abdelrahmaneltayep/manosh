import type { Buyer, Company, Quote, QuoteLine, QuoteStatus } from "@prisma/client";
import prisma from "../db.server";
import {
  applyAutoExpiry,
  counterQuote,
  expireQuote,
  isExpired,
  QuoteNotFoundError,
  type CounterLineInput,
} from "./quote.server";

/**
 * Merchant Quote Inbox (F1) read/write helpers. Kept UI-free so the route
 * loaders/actions stay thin and the counter logic is testable without mocking
 * Shopify admin auth. Every function is scoped to the authenticated shop's
 * domain — a merchant can only ever see/act on their own quotes.
 */

export interface InboxRow {
  id: string;
  status: QuoteStatus;
  /** Effective status for display: a due non-terminal quote shows EXPIRED. */
  displayStatus: QuoteStatus;
  companyName: string;
  buyerEmail: string;
  lineCount: number;
  createdAt: Date;
  expiresAt: Date;
  poReference: string | null;
}

export type QuoteDetail = Quote & {
  lines: QuoteLine[];
  buyer: Buyer;
  company: Company;
};

/**
 * List a shop's quotes for the inbox. This is a read (GET) path, so it does NOT
 * write: expiry is reflected via `displayStatus` computed from the clock. The
 * authoritative flip happens on the cron (`expireQuotesDue`) or when a quote's
 * detail is opened.
 */
export async function listQuotesForShop(shopDomain: string): Promise<InboxRow[]> {
  const quotes = await prisma.quote.findMany({
    where: { company: { shop: { shopifyDomain: shopDomain } } },
    include: {
      company: true,
      buyer: true,
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  return quotes.map((quote) => ({
    id: quote.id,
    status: quote.status,
    displayStatus: isExpired(quote, now) ? "EXPIRED" : quote.status,
    companyName: quote.company.name,
    buyerEmail: quote.buyer.email,
    lineCount: quote._count.lines,
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt,
    poReference: quote.poReference,
  }));
}

/** True when a quote belongs to the given shop. */
async function isOwnedByShop(
  shopDomain: string,
  quoteId: string,
): Promise<boolean> {
  const owned = await prisma.quote.findFirst({
    where: { id: quoteId, company: { shop: { shopifyDomain: shopDomain } } },
    select: { id: true },
  });
  return owned !== null;
}

/**
 * Load one quote's detail for the shop, or null if it isn't theirs. Applies
 * auto-expiry on read (per F1: "expiry auto-flips on read").
 */
export async function getQuoteDetailForShop(
  shopDomain: string,
  quoteId: string,
): Promise<QuoteDetail | null> {
  if (!(await isOwnedByShop(shopDomain, quoteId))) return null;
  await applyAutoExpiry(quoteId);
  return prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true, buyer: true, company: true },
  });
}

/** Send a counter for one of the shop's quotes (SUBMITTED → COUNTERED). */
export async function counterQuoteForShop(
  shopDomain: string,
  quoteId: string,
  lines: CounterLineInput[],
) {
  if (!(await isOwnedByShop(shopDomain, quoteId))) {
    throw new QuoteNotFoundError(quoteId);
  }
  return counterQuote(quoteId, { lines });
}

/** Decline a quote by expiring it (any non-terminal → EXPIRED). */
export async function declineQuoteForShop(shopDomain: string, quoteId: string) {
  if (!(await isOwnedByShop(shopDomain, quoteId))) {
    throw new QuoteNotFoundError(quoteId);
  }
  return expireQuote(quoteId);
}

export type ParseCounterResult =
  | { ok: true; lines: CounterLineInput[] }
  | { ok: false; error: string };

// Money: up to 4 decimals to match QuoteLine.price Decimal(18,4).
const MONEY = /^\d+(\.\d{1,4})?$/;

/**
 * Parse the counter form: repeated `lineId` fields plus `price_<id>` and
 * `quantity_<id>`. Blank fields leave that value unchanged. Validates money and
 * quantity so bad input becomes a plain-language error, never a 500.
 */
export function parseCounterForm(form: FormData): ParseCounterResult {
  const ids = form.getAll("lineId").map(String);
  const lines: CounterLineInput[] = [];

  for (const id of ids) {
    const line: CounterLineInput = { id };

    const priceRaw = form.get(`price_${id}`);
    if (priceRaw != null && String(priceRaw).trim() !== "") {
      const price = String(priceRaw).trim();
      if (!MONEY.test(price)) {
        return { ok: false, error: "Enter a valid price for each line (e.g. 9.50)." };
      }
      line.price = price;
    }

    const qtyRaw = form.get(`quantity_${id}`);
    if (qtyRaw != null && String(qtyRaw).trim() !== "") {
      const qty = Number(qtyRaw);
      if (!Number.isInteger(qty) || qty < 1) {
        return { ok: false, error: "Quantities must be whole numbers of 1 or more." };
      }
      line.quantity = qty;
    }

    lines.push(line);
  }

  return { ok: true, lines };
}
