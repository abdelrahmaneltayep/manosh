import type { Invoice } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { agingBucket, bucketInvoices, type AgingTotals } from "../lib/aging";

/**
 * F2 — invoices raised on net-terms checkout, plus the aging aggregation the
 * dashboard reads. Money is a snapshot (Shopify owns it); we only track due
 * dates and status here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** dueDate = issuedAt + termsDays. Pure. */
export function computeDueDate(issuedAt: Date, termsDays: number): Date {
  return new Date(issuedAt.getTime() + termsDays * DAY_MS);
}

export interface CreateInvoiceInput {
  companyId: string;
  shopId: string;
  quoteId?: string | null;
  orderId?: string | null;
  amount: string | number;
  currency: string;
  termsDays: number;
  now?: Date;
}

/**
 * Create an invoice for a net-terms order and record INVOICE_CREATED. Idempotent
 * by (orderId): if an invoice already exists for the order, it's returned as-is
 * so a retry or double-checkout can't double-bill.
 */
export async function createInvoiceForOrder(input: CreateInvoiceInput): Promise<Invoice> {
  const now = input.now ?? new Date();

  if (input.orderId) {
    const existing = await prisma.invoice.findFirst({ where: { orderId: input.orderId } });
    if (existing) return existing;
  }

  const amount = typeof input.amount === "number" ? input.amount.toFixed(4) : input.amount;

  // F14 — allocate a compliant sequential invoice number (Growth + flag on).
  // Best-effort: numbering must never block invoice creation.
  let sequenceNo: number | null = null;
  try {
    const { allocateInvoiceNumber } = await import("./tax.server");
    const shop = await prisma.shop.findUnique({ where: { id: input.shopId }, select: { plan: true } });
    const allocated = await allocateInvoiceNumber(input.shopId, shop?.plan ?? null);
    sequenceNo = allocated?.sequenceNo ?? null;
  } catch {
    /* fall back to the id-based number */
  }

  const invoice = await prisma.invoice.create({
    data: {
      companyId: input.companyId,
      quoteId: input.quoteId ?? null,
      orderId: input.orderId ?? null,
      amount,
      currency: input.currency,
      status: "OPEN",
      sequenceNo,
      issuedAt: now,
      dueDate: computeDueDate(now, input.termsDays),
    },
  });

  await appendEvent({
    shopId: input.shopId,
    type: "INVOICE_CREATED",
    entityType: "Invoice",
    entityId: invoice.id,
    // ids + numbers only — no PII (guardrail #6).
    payload: { companyId: input.companyId, termsDays: input.termsDays },
  });

  // F10 — queue an accounting sync (QBO/Xero) for this invoice. Best-effort and
  // dark-launched: enqueueInvoiceSync no-ops unless MANNON_FF_ACCOUNTING_SYNC is
  // on and a provider is connected, and it never throws into the order flow.
  try {
    const { enqueueInvoiceSync } = await import("./accounting.server");
    await enqueueInvoiceSync(input.shopId, invoice.id);
  } catch (error) {
    const { captureException } = await import("../lib/sentry.server");
    captureException(error);
  }

  return invoice;
}

export async function listInvoicesForCompany(companyId: string): Promise<Invoice[]> {
  return prisma.invoice.findMany({
    where: { companyId },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

/** One invoice, scoped to a company (buyer portal ownership check). */
export async function getInvoiceForCompany(
  invoiceId: string,
  companyId: string,
): Promise<Invoice | null> {
  return prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
}

export interface InvoiceRow {
  id: string;
  companyName: string;
  amount: string;
  currency: string;
  status: string;
  issuedAt: Date;
  dueDate: Date;
}

/** Recent invoices across the shop, newest first (for the merchant invoices view). */
export async function listRecentInvoicesForShop(
  shopDomain: string,
  take = 100,
): Promise<InvoiceRow[]> {
  const rows = await prisma.invoice.findMany({
    where: { company: { shop: { shopifyDomain: shopDomain } } },
    include: { company: { select: { name: true } } },
    orderBy: { issuedAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    companyName: r.company.name,
    amount: r.amount.toString(),
    currency: r.currency,
    status: r.status,
    issuedAt: r.issuedAt,
    dueDate: r.dueDate,
  }));
}

/** Verify an invoice belongs to the shop before a merchant mutates it. */
export async function invoiceBelongsToShop(invoiceId: string, shopDomain: string): Promise<boolean> {
  const found = await prisma.invoice.findFirst({
    where: { id: invoiceId, company: { shop: { shopifyDomain: shopDomain } } },
    select: { id: true },
  });
  return found !== null;
}

export async function markInvoicePaid(invoiceId: string, now: Date = new Date()): Promise<Invoice> {
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "PAID", paidAt: now },
  });
}

/**
 * Flip OPEN invoices whose due date has passed to OVERDUE. Cheap to run before
 * showing the aging dashboard and inside the reminder job. Returns the count.
 */
export async function refreshOverdue(shopId: string, now: Date = new Date()): Promise<number> {
  const res = await prisma.invoice.updateMany({
    where: {
      status: "OPEN",
      dueDate: { lt: now },
      company: { shopId },
    },
    data: { status: "OVERDUE" },
  });
  return res.count;
}

export interface CompanyAgingRow {
  companyId: string;
  companyName: string;
  outstanding: number;
  buckets: AgingTotals;
  onHold: boolean;
  creditLimit: number;
}

export interface AgingReport {
  totals: AgingTotals;
  rows: CompanyAgingRow[];
}

/** Aging report for the whole shop: shop totals + per-company breakdown. */
export async function getAgingReport(shopDomain: string, now: Date = new Date()): Promise<AgingReport> {
  const companies = await prisma.company.findMany({
    where: { shop: { shopifyDomain: shopDomain } },
    include: {
      creditProfile: true,
      invoices: {
        where: { status: { in: ["OPEN", "OVERDUE"] } },
        select: { amount: true, dueDate: true, status: true },
      },
    },
  });

  const rows: CompanyAgingRow[] = [];
  const shopTotals: AgingTotals = { current: 0, "1-30": 0, "31-60": 0, "60+": 0 };

  for (const c of companies) {
    if (c.invoices.length === 0 && !c.creditProfile) continue;
    const invoices = c.invoices.map((i) => ({
      amount: Number(i.amount),
      dueDate: i.dueDate,
      status: i.status,
    }));
    const buckets = bucketInvoices(invoices, now);
    const outstanding = invoices.reduce((s, i) => s + i.amount, 0);
    for (const inv of invoices) shopTotals[agingBucket(inv.dueDate, now)] += inv.amount;
    rows.push({
      companyId: c.id,
      companyName: c.name,
      outstanding,
      buckets,
      onHold: c.creditProfile?.status === "HOLD",
      creditLimit: c.creditProfile ? Number(c.creditProfile.creditLimit) : 0,
    });
  }

  rows.sort((a, b) => b.outstanding - a.outstanding);
  return { totals: shopTotals, rows };
}
