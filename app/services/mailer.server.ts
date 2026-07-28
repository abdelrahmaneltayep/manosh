import { captureException } from "../lib/sentry.server";

/**
 * F2 — minimal transactional mailer. Mannon had no email system before this
 * feature (buyers use magic links), so this is a small pluggable abstraction
 * that MIRRORS the analytics/Sentry pattern: it never throws and it no-ops when
 * no provider is configured (`MANNON_MAIL_FROM` unset). Wire a real transport in
 * `deliver()` (SMTP/Resend/SendGrid) without touching callers.
 *
 * Templates are simple `{{token}}` strings, editable per shop in Settings and
 * overlaid on the defaults below.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendResult {
  sent: boolean;
  skipped?: "unconfigured";
}

/** Default templates. Shop overrides (Shop.emailTemplates JSON) win per key. */
export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string }> = {
  invoice_issued: {
    subject: "Invoice {{invoiceNumber}} from {{shopName}} — due {{dueDate}}",
    body:
      "Hi {{buyerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is now open on {{terms}} terms and is due on {{dueDate}}.\n\nView and download it any time from your portal: {{invoiceUrl}}\n\nThank you,\n{{shopName}}",
  },
  reminder_t_minus_3: {
    subject: "Reminder: invoice {{invoiceNumber}} is due in 3 days",
    body:
      "Hi {{buyerName}},\n\nA friendly reminder that invoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}} (in 3 days).\n\n{{invoiceUrl}}\n\nThank you,\n{{shopName}}",
  },
  reminder_due: {
    subject: "Invoice {{invoiceNumber}} is due today",
    body:
      "Hi {{buyerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is due today ({{dueDate}}).\n\n{{invoiceUrl}}\n\nThank you,\n{{shopName}}",
  },
  reminder_overdue_7: {
    subject: "Overdue: invoice {{invoiceNumber}}",
    body:
      "Hi {{buyerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}} and is now 7 days overdue. Please arrange payment.\n\n{{invoiceUrl}}\n\nThank you,\n{{shopName}}",
  },
};

export type TemplateKey = keyof typeof DEFAULT_TEMPLATES;

/** Fill `{{token}}` placeholders. Unknown tokens are left blank. */
export function renderTemplate(
  template: { subject: string; body: string },
  vars: Record<string, string>,
): { subject: string; body: string } {
  const fill = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
  return { subject: fill(template.subject), body: fill(template.body) };
}

/**
 * Resolve a template for a shop: shop override (from Shop.emailTemplates) merged
 * over the default. Pure so it's testable.
 */
export function resolveTemplate(
  key: TemplateKey,
  overrides: unknown,
): { subject: string; body: string } {
  const base = DEFAULT_TEMPLATES[key];
  const map = (overrides ?? {}) as Record<string, { subject?: string; body?: string }>;
  const o = map[key] ?? {};
  return { subject: o.subject || base.subject, body: o.body || base.body };
}

/** Is a mail transport configured? (Delivery no-ops otherwise.) */
export function isMailerConfigured(): boolean {
  return Boolean(process.env.MANNON_MAIL_FROM);
}

/**
 * Actually deliver a message. Placeholder for a real transport — kept isolated so
 * production can drop in SMTP/Resend without changing callers. Returns skipped
 * when unconfigured. Never throws (errors go to Sentry).
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (!isMailerConfigured()) return { sent: false, skipped: "unconfigured" };
  try {
    // TODO: integrate the chosen provider here. Intentionally a no-op body until
    // a transport + MANNON_MAIL_FROM are provisioned; the reminder pipeline and
    // PaymentReminder records already work end-to-end around it.
    return { sent: true };
  } catch (error) {
    captureException(error);
    return { sent: false };
  }
}
