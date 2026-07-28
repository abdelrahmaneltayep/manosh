import type {
  EventType,
  Prisma,
  Quote,
  QuoteLine,
  QuoteStatus,
} from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";

/**
 * Quote status machine (F1) — pure domain logic, no UI.
 *
 *   SUBMITTED ──counter──▶ COUNTERED ──accept──▶ ACCEPTED ──order──▶ ORDERED
 *       │                      │                     │
 *       └──────────── expire (default 14d) ──────────┴──▶ EXPIRED
 *
 * Rules (see /docs/prd.md F1):
 * - Illegal transitions throw. Accept requires a COUNTERED quote; terminal
 *   states (ORDERED, EXPIRED) can't be reopened.
 * - Expiry auto-flips on read and via cron.
 * - Every transition appends an Event.
 */

export type QuoteWithLines = Quote & { lines: QuoteLine[] };

// The only legal transitions. A status with an empty list is terminal.
const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  SUBMITTED: ["COUNTERED", "EXPIRED"],
  COUNTERED: ["ACCEPTED", "EXPIRED"],
  ACCEPTED: ["ORDERED", "EXPIRED"],
  ORDERED: [],
  EXPIRED: [],
};

// Event appended for each destination status.
const EVENT_FOR_STATUS: Record<QuoteStatus, EventType> = {
  SUBMITTED: "QUOTE_SUBMITTED",
  COUNTERED: "QUOTE_COUNTERED",
  ACCEPTED: "QUOTE_ACCEPTED",
  ORDERED: "QUOTE_ORDERED",
  EXPIRED: "QUOTE_EXPIRED",
};

export class IllegalQuoteTransitionError extends Error {
  constructor(
    public readonly from: QuoteStatus,
    public readonly to: QuoteStatus,
  ) {
    super(`Illegal quote transition: ${from} → ${to}`);
    this.name = "IllegalQuoteTransitionError";
  }
}

export class QuoteNotFoundError extends Error {
  constructor(public readonly quoteId: string) {
    super(`Quote ${quoteId} not found`);
    this.name = "QuoteNotFoundError";
  }
}

export class QuoteConcurrencyError extends Error {
  constructor(public readonly quoteId: string) {
    super(`Quote ${quoteId} changed concurrently; transition not applied`);
    this.name = "QuoteConcurrencyError";
  }
}

export function isTerminal(status: QuoteStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalQuoteTransitionError(from, to);
  }
}

/** A non-terminal quote whose expiry has passed is effectively expired. */
export function isExpired(
  quote: Pick<Quote, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  return !isTerminal(quote.status) && quote.expiresAt.getTime() <= now.getTime();
}

export interface QuoteLineInput {
  variantId: string;
  sku?: string | null;
  title: string;
  quantity: number;
  /** Money as a string, never a float (see CLAUDE.md). */
  price: string;
}

/**
 * Create and submit a new quote (the SUBMITTED entry point). Expiry is derived
 * from the shop's `quoteExpiryDays` unless overridden. Appends QUOTE_SUBMITTED.
 */
export async function submitQuote(input: {
  companyId: string;
  buyerId: string;
  lines: QuoteLineInput[];
  poReference?: string | null;
  expiryDays?: number;
  placedByRepId?: string | null;
  now?: Date;
}): Promise<QuoteWithLines> {
  const now = input.now ?? new Date();
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    include: { shop: true },
  });
  if (!company) {
    throw new Error(`Company ${input.companyId} not found`);
  }
  const expiryDays = input.expiryDays ?? company.shop.quoteExpiryDays;
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        companyId: input.companyId,
        buyerId: input.buyerId,
        status: "SUBMITTED",
        expiresAt,
        poReference: input.poReference ?? null,
        placedByRepId: input.placedByRepId ?? null,
        lines: {
          create: input.lines.map((line) => ({
            variantId: line.variantId,
            sku: line.sku ?? null,
            title: line.title,
            quantity: line.quantity,
            price: line.price,
          })),
        },
      },
      include: { lines: true },
    });
    await appendEvent(
      {
        shopId: company.shopId,
        type: "QUOTE_SUBMITTED",
        entityType: "Quote",
        entityId: quote.id,
        payload: { to: "SUBMITTED", lineCount: input.lines.length },
      },
      tx,
    );
    return quote;
  });
}

interface TransitionOptions {
  now?: Date;
  /** Extra fields to write on the quote as part of the transition. */
  data?: Prisma.QuoteUpdateInput;
  /** Extra writes (e.g. line updates) to run in the same transaction. */
  apply?: (tx: Prisma.TransactionClient, quote: Quote) => Promise<void>;
  /** Extra fields merged into the appended event payload. */
  eventPayload?: Prisma.InputJsonObject;
}

/**
 * Apply a guarded transition. Auto-expiry is committed first (in its own
 * transaction) so that, e.g., countering a time-expired quote persists the
 * EXPIRED flip and then correctly fails the guard — the expiry is not rolled
 * back with the rejected transition.
 */
async function runTransition(
  quoteId: string,
  to: QuoteStatus,
  options: TransitionOptions = {},
): Promise<QuoteWithLines> {
  const now = options.now ?? new Date();
  await applyAutoExpiry(quoteId, now);

  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { id: quoteId },
      include: { company: true },
    });
    if (!quote) throw new QuoteNotFoundError(quoteId);

    assertTransition(quote.status, to);

    const updated = await tx.quote.updateMany({
      where: { id: quoteId, status: quote.status },
      data: { status: to, ...options.data },
    });
    if (updated.count !== 1) {
      throw new QuoteConcurrencyError(quoteId);
    }

    if (options.apply) {
      await options.apply(tx, quote);
    }

    await appendEvent(
      {
        shopId: quote.company.shopId,
        type: EVENT_FOR_STATUS[to],
        entityType: "Quote",
        entityId: quoteId,
        payload: { from: quote.status, to, ...options.eventPayload },
      },
      tx,
    );

    return tx.quote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { lines: true },
    });
  });
}

export interface CounterLineInput {
  id: string;
  price?: string;
  quantity?: number;
}

/** SUBMITTED → COUNTERED. Optionally revise line prices/quantities. */
export async function counterQuote(
  quoteId: string,
  options: { lines?: CounterLineInput[]; now?: Date } = {},
): Promise<QuoteWithLines> {
  return runTransition(quoteId, "COUNTERED", {
    now: options.now,
    apply: async (tx, quote) => {
      for (const line of options.lines ?? []) {
        // Only touch lines that belong to this quote.
        await tx.quoteLine.updateMany({
          where: { id: line.id, quoteId: quote.id },
          data: {
            ...(line.price !== undefined ? { price: line.price } : {}),
            ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
          },
        });
      }
    },
    eventPayload: options.lines?.length
      ? { revisedLines: options.lines.length }
      : undefined,
  });
}

/** COUNTERED → ACCEPTED. */
export async function acceptQuote(
  quoteId: string,
  options: { now?: Date } = {},
): Promise<QuoteWithLines> {
  return runTransition(quoteId, "ACCEPTED", { now: options.now });
}

/**
 * ACCEPTED → ORDERED. Stores the draft order id and totals snapshot from
 * Shopify (S8). We never recompute those — snapshot only.
 */
export async function markOrdered(
  quoteId: string,
  options: {
    draftOrderId?: string;
    totalsSnapshot?: Prisma.InputJsonValue;
    now?: Date;
  } = {},
): Promise<QuoteWithLines> {
  return runTransition(quoteId, "ORDERED", {
    now: options.now,
    data: {
      ...(options.draftOrderId ? { draftOrderId: options.draftOrderId } : {}),
      ...(options.totalsSnapshot !== undefined
        ? { totalsSnapshot: options.totalsSnapshot }
        : {}),
    },
  });
}

/** Manually expire a non-terminal quote (any of SUBMITTED/COUNTERED/ACCEPTED). */
export async function expireQuote(
  quoteId: string,
  options: { now?: Date } = {},
): Promise<QuoteWithLines> {
  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { id: quoteId },
      include: { company: true },
    });
    if (!quote) throw new QuoteNotFoundError(quoteId);
    assertTransition(quote.status, "EXPIRED");

    const updated = await tx.quote.updateMany({
      where: { id: quoteId, status: quote.status },
      data: { status: "EXPIRED" },
    });
    if (updated.count !== 1) throw new QuoteConcurrencyError(quoteId);

    await appendEvent(
      {
        shopId: quote.company.shopId,
        type: "QUOTE_EXPIRED",
        entityType: "Quote",
        entityId: quoteId,
        payload: { from: quote.status, to: "EXPIRED", reason: "manual" },
      },
      tx,
    );
    return tx.quote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { lines: true },
    });
  });
}

/**
 * Flip a single quote to EXPIRED if its expiry has passed. Runs in its own
 * transaction so the change is committed independently of any caller. Returns
 * the (possibly updated) status, or null if the quote no longer exists.
 */
export async function applyAutoExpiry(
  quoteId: string,
  now: Date = new Date(),
): Promise<QuoteStatus | null> {
  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { id: quoteId },
      include: { company: true },
    });
    if (!quote) return null;
    if (!isExpired(quote, now)) return quote.status;

    const updated = await tx.quote.updateMany({
      where: { id: quoteId, status: quote.status },
      data: { status: "EXPIRED" },
    });
    if (updated.count === 1) {
      await appendEvent(
        {
          shopId: quote.company.shopId,
          type: "QUOTE_EXPIRED",
          entityType: "Quote",
          entityId: quoteId,
          payload: { from: quote.status, to: "EXPIRED", reason: "auto" },
        },
        tx,
      );
      return "EXPIRED";
    }
    return quote.status;
  });
}

/** Read a quote, auto-expiring it first if due. */
export async function getQuote(
  quoteId: string,
  options: { now?: Date } = {},
): Promise<QuoteWithLines | null> {
  await applyAutoExpiry(quoteId, options.now ?? new Date());
  return prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true },
  });
}

/**
 * Cron entry point: expire every non-terminal quote whose expiry has passed.
 * Returns the number expired. Each writes a QUOTE_EXPIRED event.
 */
export async function expireQuotesDue(
  options: { now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const due = await prisma.quote.findMany({
    where: {
      status: { in: ["SUBMITTED", "COUNTERED", "ACCEPTED"] },
      expiresAt: { lte: now },
    },
    select: { id: true },
  });

  let expired = 0;
  for (const { id } of due) {
    const status = await applyAutoExpiry(id, now);
    if (status === "EXPIRED") expired += 1;
  }
  return expired;
}
