import type { PaymentPlanType } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { hashToken, generateMagicToken } from "./magic-link.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import {
  buildSchedule,
  remainingBalance,
  paidToDate,
  installmentStatus,
  planStatus,
  payLinkRedeemable,
  type PlanType,
} from "../lib/payments";

/**
 * F13 — Flexible Payments service (deposits / installments / pay-by-link).
 * Growth-only, dark-launched behind MANNON_FF_FLEX_PAY.
 *
 * GUARDRAIL: Mannon never stores or touches card data. This module only computes
 * server-authoritative amounts (app/lib/payments.ts) and orchestrates
 * Shopify-hosted capture — the deposit runs through the draft-order/checkout,
 * and a pay-link redeems against a Shopify-hosted payment. No card fields, ever.
 */

export const FLEX_PAY_ENABLED = () => process.env.MANNON_FF_FLEX_PAY === "true";

const DEFAULT_DUE_DAYS = 30;
const PAYLINK_EXPIRY_DAYS = 14;

export class PlanExistsError extends Error {}
export class NotFoundError extends Error {}

// --- default deposit policy (Shop setting) -----------------------------------

export async function getDefaultDepositPct(shopDomain: string): Promise<number | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { defaultDepositPct: true } });
  return shop?.defaultDepositPct ?? null;
}

export async function setDefaultDepositPct(shopDomain: string, pct: number | null): Promise<void> {
  await prisma.shop.update({ where: { shopifyDomain: shopDomain }, data: { defaultDepositPct: pct } });
}

// --- plan creation -----------------------------------------------------------

export interface CreatePlanInput {
  type: PlanType;
  depositPct?: number; // fraction 0..1
  installments?: number;
  intervalDays?: number;
  dueInDays?: number; // when the first balance installment is due (from now)
}

async function loadQuoteOrder(quoteId: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      totalsSnapshot: true,
      draftOrderId: true,
      company: { select: { shopId: true, name: true, shop: { select: { shopifyDomain: true } } } },
    },
  });
  if (!quote) return null;
  const totals = (quote.totalsSnapshot ?? {}) as { total?: string; currencyCode?: string };
  return { quote, total: totals.total ?? "0.00", currency: totals.currencyCode ?? "USD" };
}

/**
 * Create a payment plan for an accepted quote/order. Server-authoritative: the
 * amounts come from the quote's stored totals snapshot (never the client).
 */
export async function createPaymentPlan(
  quoteId: string,
  input: CreatePlanInput,
  now: Date = new Date(),
): Promise<{ planId: string }> {
  const loaded = await loadQuoteOrder(quoteId);
  if (!loaded) throw new NotFoundError("Order not found");
  const { quote, total, currency } = loaded;

  const existing = await prisma.paymentPlan.findUnique({ where: { quoteId }, select: { id: true } });
  if (existing) throw new PlanExistsError("A payment plan already exists for this order");

  const firstDueDate = new Date(now.getTime() + (input.dueInDays ?? DEFAULT_DUE_DAYS) * 86400000);
  const lines = buildSchedule({
    type: input.type,
    total,
    depositPct: input.depositPct,
    installments: input.installments,
    intervalDays: input.intervalDays,
    firstDueDate,
  });

  const plan = await prisma.paymentPlan.create({
    data: {
      quoteId,
      type: input.type as PaymentPlanType,
      depositPct: input.depositPct != null ? input.depositPct.toFixed(4) : null,
      totalAmount: total,
      currency,
      schedule: input as unknown as object,
      installments: {
        create: lines.map((l) => ({
          sortOrder: l.sortOrder,
          label: l.label,
          amount: l.amount,
          // The deposit/first line is "due now"; others as scheduled.
          dueDate: l.dueDate,
        })),
      },
    },
  });

  await appendEvent({
    shopId: quote.company.shopId,
    type: "PAYMENT_PLAN_CREATED",
    entityType: "Quote",
    entityId: quoteId,
    payload: { type: input.type, total, currency, lines: lines.length },
  });

  return { planId: plan.id };
}

// --- reads -------------------------------------------------------------------

export interface PlanView {
  id: string;
  type: string;
  status: string;
  total: string;
  currency: string;
  paid: string;
  remaining: string;
  installments: Array<{ id: string; label: string | null; amount: string; dueDate: Date; status: string; paidAt: Date | null }>;
}

export async function getPlanForQuote(quoteId: string, now: Date = new Date()): Promise<PlanView | null> {
  const plan = await prisma.paymentPlan.findUnique({
    where: { quoteId },
    include: { installments: { orderBy: { sortOrder: "asc" } } },
  });
  if (!plan) return null;
  const insts = plan.installments.map((i) => ({ amount: i.amount.toString(), status: i.status, dueDate: i.dueDate, paidAt: i.paidAt }));
  return {
    id: plan.id,
    type: plan.type,
    status: planStatus(insts, now),
    total: plan.totalAmount.toString(),
    currency: plan.currency,
    paid: paidToDate(insts),
    remaining: remainingBalance(insts),
    installments: plan.installments.map((i) => ({
      id: i.id,
      label: i.label,
      amount: i.amount.toString(),
      dueDate: i.dueDate,
      status: installmentStatus({ status: i.status, dueDate: i.dueDate, paidAt: i.paidAt }, now),
      paidAt: i.paidAt,
    })),
  };
}

export interface ShopPlanRow {
  quoteId: string;
  companyName: string;
  type: string;
  status: string;
  total: string;
  remaining: string;
  currency: string;
}

export async function listPlansForShop(shopDomain: string, opts: { overdueOnly?: boolean } = {}, now: Date = new Date()): Promise<ShopPlanRow[]> {
  const plans = await prisma.paymentPlan.findMany({
    where: { quote: { company: { shop: { shopifyDomain: shopDomain } } } },
    include: { installments: true, quote: { select: { company: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const rows = plans.map((p) => {
    const insts = p.installments.map((i) => ({ amount: i.amount.toString(), status: i.status, dueDate: i.dueDate, paidAt: i.paidAt }));
    return {
      quoteId: p.quoteId,
      companyName: p.quote.company.name,
      type: p.type,
      status: planStatus(insts, now),
      total: p.totalAmount.toString(),
      remaining: remainingBalance(insts),
      currency: p.currency,
    };
  });
  return opts.overdueOnly ? rows.filter((r) => r.status === "OVERDUE") : rows;
}

export interface EligibleOrder {
  quoteId: string;
  companyName: string;
  total: string;
  currency: string;
}

/** Accepted/ordered quotes that don't yet have a payment plan (plan candidates). */
export async function listEligibleOrders(shopDomain: string): Promise<EligibleOrder[]> {
  const quotes = await prisma.quote.findMany({
    where: {
      status: { in: ["ACCEPTED", "ORDERED"] },
      paymentPlan: null,
      company: { shop: { shopifyDomain: shopDomain } },
    },
    select: { id: true, totalsSnapshot: true, company: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return quotes.map((q) => {
    const t = (q.totalsSnapshot ?? {}) as { total?: string; currencyCode?: string };
    return { quoteId: q.id, companyName: q.company.name, total: t.total ?? "0.00", currency: t.currencyCode ?? "USD" };
  });
}

// --- pay-by-link -------------------------------------------------------------

/**
 * Issue a tokenized, single-use, expiring pay-link for a specific amount. Only
 * the token hash is stored; the raw token lives only in the returned URL, and
 * no amount/PII is placed in the URL beyond the opaque token.
 */
export async function issuePayLink(
  quoteId: string,
  input: { installmentId?: string | null; baseUrl: string },
  now: Date = new Date(),
): Promise<{ url: string; amount: string; currency: string }> {
  const plan = await prisma.paymentPlan.findUnique({
    where: { quoteId },
    include: { installments: true, quote: { select: { company: { select: { shop: { select: { shopifyDomain: true } }, buyers: { where: { status: "ACTIVE" }, select: { email: true, name: true }, take: 1 } } } } } },
  });
  if (!plan) throw new NotFoundError("No payment plan for this order");

  // Amount is server-derived: a specific installment, else the remaining balance.
  let amount: string;
  let installmentId: string | null = input.installmentId ?? null;
  if (installmentId) {
    const inst = plan.installments.find((i) => i.id === installmentId);
    if (!inst) throw new NotFoundError("Installment not found");
    amount = inst.amount.toString();
  } else {
    amount = remainingBalance(plan.installments.map((i) => ({ amount: i.amount.toString(), status: i.status, dueDate: i.dueDate, paidAt: i.paidAt })));
  }

  const { raw, hash } = generateMagicToken();
  await prisma.payLink.create({
    data: {
      quoteId,
      installmentId,
      tokenHash: hash,
      amount,
      currency: plan.currency,
      expiresAt: new Date(now.getTime() + PAYLINK_EXPIRY_DAYS * 86400000),
    },
  });

  const url = new URL(`/pay/${raw}`, input.baseUrl).toString();

  // Best-effort: email the buyer the link too (the merchant also gets the URL to copy).
  const buyer = plan.quote.company.buyers[0];
  if (buyer) {
    try {
      const tpl = renderTemplate(resolveTemplate("paylink", null), {
        buyerName: buyer.name ?? "there",
        amount: `${plan.currency} ${amount}`,
        payUrl: url,
        shopName: plan.quote.company.shop.shopifyDomain,
      });
      await sendEmail({ to: buyer.email, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
    } catch (error) {
      captureException(error);
    }
  }

  return { url, amount, currency: plan.currency };
}

export interface PayLinkView {
  amount: string;
  currency: string;
  companyName: string;
  redeemable: boolean;
  reason?: string;
}

/** Peek a pay-link by raw token (no consumption) for the public pay page. */
export async function getPayLink(rawToken: string, now: Date = new Date()): Promise<PayLinkView | null> {
  const link = await prisma.payLink.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { quote: { select: { company: { select: { name: true } } } } },
  });
  if (!link) return null;
  const r = payLinkRedeemable(link, now);
  return { amount: link.amount.toString(), currency: link.currency, companyName: link.quote.company.name, redeemable: r.ok, reason: r.reason };
}

/**
 * Redeem a pay-link: mark it used, mark its installment paid, recompute the plan,
 * log PAYLINK_PAID. Single-use via an atomic conditional update (a replay loses
 * the race). In production the redemption completes AFTER Shopify-hosted capture
 * succeeds — this never sees card data.
 */
export async function redeemPayLink(rawToken: string, now: Date = new Date()): Promise<{ ok: boolean; reason?: string }> {
  const hash = hashToken(rawToken);
  const link = await prisma.payLink.findUnique({ where: { tokenHash: hash }, include: { quote: { select: { company: { select: { shopId: true } } } } } });
  if (!link) return { ok: false, reason: "invalid" };
  const r = payLinkRedeemable(link, now);
  if (!r.ok) return { ok: false, reason: r.reason };

  const consumed = await prisma.payLink.updateMany({
    where: { id: link.id, usedAt: null, status: "ACTIVE" },
    data: { usedAt: now, status: "PAID" },
  });
  if (consumed.count !== 1) return { ok: false, reason: "used" };

  if (link.installmentId) {
    await markInstallmentPaid(link.installmentId, now);
  }

  await appendEvent({
    shopId: link.quote.company.shopId,
    type: "PAYLINK_PAID",
    entityType: "Quote",
    entityId: link.quoteId,
    payload: { amount: link.amount.toString(), currency: link.currency },
  });
  return { ok: true };
}

// --- settlement + reconciliation ---------------------------------------------

/**
 * Mark an installment paid (from a redeemed pay-link, a deposit checkout webhook,
 * or a merchant manual mark). Recomputes the plan; when fully paid, reconciles
 * the order as paid and (if F10 is on) triggers an accounting sync.
 */
export async function markInstallmentPaid(installmentId: string, now: Date = new Date()): Promise<void> {
  const inst = await prisma.paymentInstallment.findUnique({
    where: { id: installmentId },
    include: { paymentPlan: { include: { installments: true, quote: { select: { id: true, draftOrderId: true, company: { select: { shopId: true, shop: { select: { shopifyDomain: true } } } } } } } } },
  });
  if (!inst || inst.status === "PAID") return;

  await prisma.paymentInstallment.update({ where: { id: installmentId }, data: { status: "PAID", paidAt: now } });
  await appendEvent({
    shopId: inst.paymentPlan.quote.company.shopId,
    type: "INSTALLMENT_PAID",
    entityType: "PaymentInstallment",
    entityId: installmentId,
    payload: { amount: inst.amount.toString() },
  });

  // Recompute plan status.
  const others = inst.paymentPlan.installments.map((i) => (i.id === installmentId ? { ...i, status: "PAID" as const, paidAt: now } : i));
  const status = planStatus(others.map((i) => ({ amount: i.amount.toString(), status: i.status, dueDate: i.dueDate, paidAt: i.paidAt })), now);
  await prisma.paymentPlan.update({ where: { id: inst.paymentPlanId }, data: { status } });

  if (status === "COMPLETED") {
    await reconcileOrderPaid(inst.paymentPlan.quote.id, inst.paymentPlan.quote.company.shopId);
  }
}

/** When a plan completes, mark any net-terms invoice paid + trigger F10 sync. Best-effort. */
async function reconcileOrderPaid(quoteId: string, shopId: string): Promise<void> {
  try {
    const invoice = await prisma.invoice.findFirst({ where: { quoteId, status: { in: ["OPEN", "OVERDUE"] } }, select: { id: true } });
    if (invoice) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", paidAt: new Date() } });
      if (process.env.MANNON_FF_ACCOUNTING_SYNC === "true") {
        const { enqueueInvoiceSync } = await import("./accounting.server");
        await enqueueInvoiceSync(shopId, invoice.id);
      }
    }
  } catch (error) {
    captureException(error);
  }
}

// --- reminders (overdue installments) ----------------------------------------

/**
 * Flip overdue installments/plans + send due/overdue reminder emails, idempotent
 * per installment+stage (tracked in reminderStages). Reuses the F8 conventions
 * (unsubscribe + timezone quiet-hours are handled by the shared mailer). Called
 * by /internal/cron/payment-reminders.
 */
export async function runPaymentRemindersForShop(shopDomain: string, baseUrl: string, now: Date = new Date()): Promise<{ due: number; overdue: number }> {
  const plans = await prisma.paymentPlan.findMany({
    where: { status: { not: "COMPLETED" }, quote: { company: { shop: { shopifyDomain: shopDomain } } } },
    include: {
      installments: true,
      quote: { select: { id: true, company: { select: { name: true, buyers: { where: { status: "ACTIVE" }, select: { email: true, name: true }, take: 1 } } } } },
    },
  });

  let due = 0;
  let overdue = 0;
  for (const plan of plans) {
    const buyer = plan.quote.company.buyers[0];
    for (const inst of plan.installments) {
      if (inst.status === "PAID" || inst.paidAt) continue;
      const live = installmentStatus({ status: inst.status, dueDate: inst.dueDate, paidAt: inst.paidAt }, now);
      const stages = new Set((inst.reminderStages as string[] | null) ?? []);

      // Flip stored status if it drifted to OVERDUE.
      if (live === "OVERDUE" && inst.status !== "OVERDUE") {
        await prisma.paymentInstallment.update({ where: { id: inst.id }, data: { status: "OVERDUE" } });
      }

      let stage: "DUE" | "OVERDUE" | null = null;
      const daysToDue = Math.ceil((inst.dueDate.getTime() - now.getTime()) / 86400000);
      if (live === "OVERDUE" && !stages.has("OVERDUE")) stage = "OVERDUE";
      else if (live === "PENDING" && daysToDue <= 3 && daysToDue >= 0 && !stages.has("DUE")) stage = "DUE";
      if (!stage) continue;

      if (buyer) {
        const tplKey = stage === "OVERDUE" ? "installment_overdue" : "installment_due";
        const tpl = renderTemplate(resolveTemplate(tplKey, null), {
          buyerName: buyer.name ?? "there",
          amount: `${plan.currency} ${inst.amount.toString()}`,
          dueDate: inst.dueDate.toISOString().slice(0, 10),
          payUrl: new URL(`/portal/quotes/${plan.quote.id}`, baseUrl).toString(),
          shopName: shopDomain,
        });
        await sendEmail({ to: buyer.email, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
      }
      stages.add(stage);
      await prisma.paymentInstallment.update({ where: { id: inst.id }, data: { reminderStages: [...stages] } });
      if (stage === "OVERDUE") overdue++;
      else due++;
    }

    // Refresh plan status after any flips.
    const fresh = await prisma.paymentInstallment.findMany({ where: { paymentPlanId: plan.id } });
    const status = planStatus(fresh.map((i) => ({ amount: i.amount.toString(), status: i.status, dueDate: i.dueDate, paidAt: i.paidAt })), now);
    if (status !== plan.status) await prisma.paymentPlan.update({ where: { id: plan.id }, data: { status } });
  }

  return { due, overdue };
}
