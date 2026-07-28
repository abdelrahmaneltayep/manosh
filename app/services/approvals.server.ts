import type { OrderApproval } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { routeToApprovers } from "../lib/company-accounts";

/**
 * F5 — spending approvals. When a quote's total reaches the company's
 * approvalThreshold (Growth), the order can't be placed until an approver
 * approves. This module owns the pending/decided record + notifications.
 */

/** Estimate a quote's order total from its lines (qty × price). */
export async function estimateQuoteAmount(quoteId: string): Promise<number> {
  const lines = await prisma.quoteLine.findMany({
    where: { quoteId },
    select: { quantity: true, price: true },
  });
  return lines.reduce((sum, l) => sum + l.quantity * Number(l.price), 0);
}

export async function getApprovalForQuote(quoteId: string): Promise<OrderApproval | null> {
  return prisma.orderApproval.findUnique({ where: { quoteId } });
}

/**
 * Ensure a pending approval exists for a quote (idempotent). On first creation,
 * notifies the company's approvers. Returns the current approval record.
 */
export async function ensurePendingApproval(params: {
  quoteId: string;
  companyId: string;
  requesterId: string;
  amount: number;
  currency: string;
  baseUrl: string;
}): Promise<OrderApproval> {
  const existing = await prisma.orderApproval.findUnique({ where: { quoteId: params.quoteId } });
  if (existing) return existing;

  const approval = await prisma.orderApproval.create({
    data: {
      quoteId: params.quoteId,
      companyId: params.companyId,
      requestedById: params.requesterId,
      amount: params.amount.toFixed(4),
      currency: params.currency,
      status: "PENDING",
    },
  });

  const company = await prisma.company.findUnique({
    where: { id: params.companyId },
    include: {
      shop: { select: { id: true, shopifyDomain: true, emailTemplates: true } },
      buyers: { select: { email: true, role: true, status: true } },
    },
  });
  if (company) {
    const approvers = routeToApprovers(
      company.buyers.map((b) => ({ email: b.email, role: b.role, status: b.status })),
    );
    const template = resolveTemplate("approval_request", company.shop.emailTemplates);
    const link = `${params.baseUrl}/portal/quotes/${params.quoteId}`;
    const { subject, body } = renderTemplate(template, {
      amount: `${params.currency} ${params.amount.toFixed(2)}`,
      approvalUrl: link,
      companyName: company.name,
      shopName: company.shop.shopifyDomain,
    });
    for (const to of approvers) await sendEmail({ to, subject, html: body, text: body });
  }
  return approval;
}

export interface DecideResult {
  approval: OrderApproval;
}

/** Approve or reject a pending approval. Emits ORDER_APPROVED on approve. */
export async function decideApproval(params: {
  approvalId: string;
  companyId: string;
  approverId: string;
  decision: "APPROVED" | "REJECTED";
  baseUrl: string;
}): Promise<DecideResult> {
  const approval = await prisma.orderApproval.findFirst({
    where: { id: params.approvalId, companyId: params.companyId, status: "PENDING" },
  });
  if (!approval) throw new Error("Approval not found or already decided.");

  const updated = await prisma.orderApproval.update({
    where: { id: approval.id },
    data: { status: params.decision, approverId: params.approverId, decidedAt: new Date() },
  });

  const company = await prisma.company.findUnique({
    where: { id: params.companyId },
    include: {
      shop: { select: { id: true, shopifyDomain: true, emailTemplates: true } },
      buyers: { where: { id: approval.requestedById }, select: { email: true } },
    },
  });
  if (company) {
    if (params.decision === "APPROVED") {
      await appendEvent({
        shopId: company.shop.id,
        type: "ORDER_APPROVED",
        entityType: "Quote",
        entityId: approval.quoteId,
        payload: { amount: Number(approval.amount) },
      });
    }
    const requester = company.buyers[0];
    if (requester) {
      const template = resolveTemplate("approval_decision", company.shop.emailTemplates);
      const { subject, body } = renderTemplate(template, {
        decision: params.decision === "APPROVED" ? "approved" : "rejected",
        quoteUrl: `${params.baseUrl}/portal/quotes/${approval.quoteId}`,
        shopName: company.shop.shopifyDomain,
      });
      await sendEmail({ to: requester.email, subject, html: body, text: body });
    }
  }
  return { approval: updated };
}

export interface PendingApprovalRow {
  id: string;
  quoteId: string;
  amount: string;
  currency: string;
  requestedByEmail: string;
}

export async function listPendingApprovals(companyId: string): Promise<PendingApprovalRow[]> {
  const rows = await prisma.orderApproval.findMany({
    where: { companyId, status: "PENDING" },
    include: { requestedBy: { select: { email: true } } },
    orderBy: { requestedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    quoteId: r.quoteId,
    amount: r.amount.toString(),
    currency: r.currency,
    requestedByEmail: r.requestedBy.email,
  }));
}
