import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { daysOverdue } from "../lib/aging";
import { formatInvoiceNumber, legacyInvoiceNumber } from "../lib/tax";
import {
  isMailerConfigured,
  renderTemplate,
  resolveTemplate,
  sendEmail,
  type TemplateKey,
} from "./mailer.server";

/**
 * F2 — payment reminders. Three stages per invoice: T-3 (3 days before due), DUE
 * (on the due date), and OVERDUE_7 (7 days past due). Idempotent: a PaymentReminder
 * row (unique on invoiceId+kind) means "already sent", so re-running the job is
 * safe. Growth-only — the cron entrypoint checks the plan before running.
 */

export type ReminderKind = "T_MINUS_3" | "DUE" | "OVERDUE_7";

const KIND_TO_TEMPLATE: Record<ReminderKind, TemplateKey> = {
  T_MINUS_3: "reminder_t_minus_3",
  DUE: "reminder_due",
  OVERDUE_7: "reminder_overdue_7",
};

/**
 * Which reminder stage (if any) an invoice is due for at `now`, pure. Returns
 * null when no stage applies. Only OPEN/OVERDUE invoices are eligible.
 */
export function stageFor(
  invoice: { status: string; dueDate: Date | string },
  now: Date | string,
): ReminderKind | null {
  if (invoice.status !== "OPEN" && invoice.status !== "OVERDUE") return null;
  const d = daysOverdue(invoice.dueDate, now); // <0 before due, 0 on due day, >0 after
  if (d === -3) return "T_MINUS_3";
  if (d === 0) return "DUE";
  if (d === 7) return "OVERDUE_7";
  return null;
}

export interface ReminderRunResult {
  considered: number;
  sent: number;
  skippedAlreadySent: number;
  mailerConfigured: boolean;
}

/**
 * Run the reminder pass for one shop. For each eligible invoice, work out its
 * stage, skip if that stage was already sent, otherwise record a PaymentReminder
 * and (best-effort) send the email + append REMINDER_SENT. `now` injectable.
 */
export async function runRemindersForShop(
  shopDomain: string,
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, emailTemplates: true },
  });
  if (!shop) return { considered: 0, sent: 0, skippedAlreadySent: 0, mailerConfigured: false };

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["OPEN", "OVERDUE"] }, company: { shopId: shop.id } },
    include: {
      reminders: { select: { kind: true } },
      company: { include: { buyers: { take: 1, orderBy: { createdAt: "asc" } } } },
    },
  });

  let sent = 0;
  let skippedAlreadySent = 0;

  for (const invoice of invoices) {
    const stage = stageFor(invoice, now);
    if (!stage) continue;
    if (invoice.reminders.some((r) => r.kind === stage)) {
      skippedAlreadySent++;
      continue;
    }

    // Record first (unique constraint on invoiceId+kind guarantees idempotency
    // even across concurrent runs).
    try {
      await prisma.paymentReminder.create({
        data: { invoiceId: invoice.id, kind: stage, channel: "EMAIL", sentAt: now },
      });
    } catch {
      skippedAlreadySent++;
      continue; // lost a race — another run already recorded this stage
    }

    const buyer = invoice.company.buyers[0];
    if (buyer) {
      const template = resolveTemplate(KIND_TO_TEMPLATE[stage], shop.emailTemplates);
      const { subject, body } = renderTemplate(template, {
        buyerName: buyer.name ?? "there",
        invoiceNumber: invoice.sequenceNo != null ? formatInvoiceNumber(invoice.sequenceNo) : legacyInvoiceNumber(invoice.id),
        amount: `${invoice.currency} ${Number(invoice.amount).toFixed(2)}`,
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
        invoiceUrl: `/portal/invoices/${invoice.id}`,
        shopName: shopDomain,
      });
      await sendEmail({ to: buyer.email, subject, html: body, text: body });
    }

    await appendEvent({
      shopId: shop.id,
      type: "REMINDER_SENT",
      entityType: "Invoice",
      entityId: invoice.id,
      payload: { kind: stage },
    });
    sent++;
  }

  return {
    considered: invoices.length,
    sent,
    skippedAlreadySent,
    mailerConfigured: isMailerConfigured(),
  };
}
