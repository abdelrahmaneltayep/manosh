import type { EventType, QuoteStatus } from "@prisma/client";
import prisma from "../db.server";
import { EXPIRING_SOON_DAYS } from "../lib/dashboard";

/**
 * F5 — ROI dashboard ("Mannon made you $X"). Read-only, derived from the
 * append-only Event stream (counts + timings) plus the money snapshots Shopify
 * returned on each order (Quote.totalsSnapshot). We never write here and never
 * compute money — revenue is a sum of totals Shopify already calculated
 * (guardrail #1: draftOrderCalculate is the single source of truth for money;
 * summing final order totals for a display metric is aggregation, not pricing).
 *
 * Kept UI-free and unit-tested. The pure helpers (exact decimal addition,
 * median, time-to-quote) are tested without a database.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Re-exported for service-side callers/tests; the source of truth (and the
// client-safe import) lives in app/lib/dashboard.ts.
export { EXPIRING_SOON_DAYS };

/** Event types the dashboard aggregates. Everything else is ignored. */
const AGGREGATED_TYPES: EventType[] = [
  "QUOTE_SUBMITTED",
  "QUOTE_COUNTERED",
  "QUOTE_ACCEPTED",
  "QUOTE_ORDERED",
  "REORDER_CREATED",
];

export interface RevenueTotal {
  amount: string;
  currencyCode: string;
}

export interface ExpiringQuote {
  id: string;
  companyName: string;
  status: QuoteStatus;
  expiresAt: Date;
}

export interface DashboardMetrics {
  /** Revenue made, summed exactly per currency, largest first. */
  revenue: RevenueTotal[];
  quotesSent: number;
  quotesAccepted: number;
  /** Quotes that became a draft order in Shopify. Drives the headline subtext. */
  ordersCount: number;
  reorders: number;
  /** Median submitted → countered time, or null if nothing has been quoted. */
  medianTimeToQuoteMs: number | null;
  expiringSoon: ExpiringQuote[];
  /** False before any activity → the dashboard shows its empty state. */
  hasActivity: boolean;
}

interface DurationEvent {
  type: EventType;
  entityId: string | null;
  createdAt: Date;
}

/**
 * Exact addition of two non-negative decimal money strings (e.g. "1234.56").
 * Money is never a float — we align the fractional digits and add as integers.
 */
export function addDecimal(a: string, b: string): string {
  const [ai, afRaw = ""] = String(a).split(".");
  const [bi, bfRaw = ""] = String(b).split(".");
  const scale = Math.max(afRaw.length, bfRaw.length);
  const an = BigInt((ai || "0") + afRaw.padEnd(scale, "0"));
  const bn = BigInt((bi || "0") + bfRaw.padEnd(scale, "0"));
  const sum = (an + bn).toString();
  if (scale === 0) return sum;
  const padded = sum.padStart(scale + 1, "0");
  const cut = padded.length - scale;
  return `${padded.slice(0, cut)}.${padded.slice(cut)}`;
}

/** Sum money snapshots per currency, largest total first. Pure. */
export function sumRevenue(
  snapshots: Array<{ total: string; currencyCode: string }>,
): RevenueTotal[] {
  const byCurrency = new Map<string, string>();
  for (const snap of snapshots) {
    const currency = snap.currencyCode || "USD";
    byCurrency.set(currency, addDecimal(byCurrency.get(currency) ?? "0", snap.total));
  }
  return [...byCurrency.entries()]
    .map(([currencyCode, amount]) => ({ currencyCode, amount }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

/** Median of a list of numbers, or null if empty. Pure. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Per-quote submitted → first-countered durations (ms), derived from the event
 * stream. A quote counts only once it's been priced (has a QUOTE_COUNTERED).
 * Pure — expects events ordered oldest-first.
 */
export function timeToQuoteDurations(events: DurationEvent[]): number[] {
  const submittedAt = new Map<string, number>();
  const counteredAt = new Map<string, number>();
  for (const event of events) {
    if (!event.entityId) continue;
    const t = event.createdAt.getTime();
    if (event.type === "QUOTE_SUBMITTED" && !submittedAt.has(event.entityId)) {
      submittedAt.set(event.entityId, t);
    } else if (event.type === "QUOTE_COUNTERED" && !counteredAt.has(event.entityId)) {
      counteredAt.set(event.entityId, t);
    }
  }
  const durations: number[] = [];
  for (const [id, submitted] of submittedAt) {
    const countered = counteredAt.get(id);
    if (countered !== undefined && countered >= submitted) {
      durations.push(countered - submitted);
    }
  }
  return durations;
}

/** Read a Quote.totalsSnapshot JSON into a validated {total, currencyCode}. */
function readSnapshotTotal(
  snapshot: unknown,
): { total: string; currencyCode: string } | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const obj = snapshot as Record<string, unknown>;
  const total = typeof obj.total === "string" ? obj.total : null;
  // Only accept a plain non-negative decimal — never trust a snapshot blindly.
  if (total === null || !/^\d+(\.\d+)?$/.test(total)) return null;
  const currencyCode =
    typeof obj.currencyCode === "string" && obj.currencyCode ? obj.currencyCode : "USD";
  return { total, currencyCode };
}

/**
 * Build the dashboard metrics for one shop. Three indexed reads run in parallel
 * (events by [shopId,type,createdAt]; ordered + expiring quotes by the Quote
 * indexes) to stay well under the p95 < 500ms bar.
 */
export async function getDashboardMetrics(
  shopId: string,
  options: { now?: Date; expiringSoonDays?: number } = {},
): Promise<DashboardMetrics> {
  const now = options.now ?? new Date();
  const windowDays = options.expiringSoonDays ?? EXPIRING_SOON_DAYS;
  const windowEnd = new Date(now.getTime() + windowDays * DAY_MS);

  const [events, orderedQuotes, expiring] = await Promise.all([
    prisma.event.findMany({
      where: { shopId, type: { in: AGGREGATED_TYPES } },
      select: { type: true, entityId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.quote.findMany({
      where: { status: "ORDERED", company: { shopId } },
      select: { totalsSnapshot: true },
    }),
    prisma.quote.findMany({
      where: {
        company: { shopId },
        status: { in: ["SUBMITTED", "COUNTERED"] },
        expiresAt: { lte: windowEnd },
      },
      orderBy: { expiresAt: "asc" },
      take: 10,
      select: {
        id: true,
        status: true,
        expiresAt: true,
        company: { select: { name: true } },
      },
    }),
  ]);

  const countOf = (type: EventType) =>
    events.reduce((n, e) => (e.type === type ? n + 1 : n), 0);

  const snapshots = orderedQuotes
    .map((q) => readSnapshotTotal(q.totalsSnapshot))
    .filter((s): s is { total: string; currencyCode: string } => s !== null);

  return {
    revenue: sumRevenue(snapshots),
    quotesSent: countOf("QUOTE_SUBMITTED"),
    quotesAccepted: countOf("QUOTE_ACCEPTED"),
    ordersCount: countOf("QUOTE_ORDERED"),
    reorders: countOf("REORDER_CREATED"),
    medianTimeToQuoteMs: median(timeToQuoteDurations(events)),
    expiringSoon: expiring.map((q) => ({
      id: q.id,
      companyName: q.company.name,
      status: q.status,
      expiresAt: q.expiresAt,
    })),
    hasActivity: events.length > 0 || snapshots.length > 0,
  };
}
