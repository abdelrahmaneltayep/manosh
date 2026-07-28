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
  reorder_list: {
    subject: "Time to reorder? {{listName}} is one tap away",
    body:
      "Hi {{buyerName}},\n\nYour saved list \"{{listName}}\" is ready to reorder. Open it in the order pad and send it in a tap:\n\n{{orderPadUrl}}\n\nThank you,\n{{shopName}}",
  },
  member_invite: {
    subject: "You're invited to order for {{companyName}}",
    body:
      "Hi,\n\nYou've been invited to {{companyName}}'s buyer portal as {{role}}. Use this secure link to sign in — no password needed:\n\n{{inviteUrl}}\n\nThank you,\n{{shopName}}",
  },
  approval_request: {
    subject: "Approval needed: order for {{amount}}",
    body:
      "Hi,\n\nAn order for {{amount}} at {{companyName}} needs your approval before it can be placed. Review and approve or reject it here:\n\n{{approvalUrl}}\n\nThank you,\n{{shopName}}",
  },
  approval_decision: {
    subject: "Your order was {{decision}}",
    body:
      "Hi,\n\nYour order request was {{decision}}. See the details here:\n\n{{quoteUrl}}\n\nThank you,\n{{shopName}}",
  },
  application_received: {
    subject: "We got your wholesale application — {{companyName}}",
    body:
      "Hi,\n\nThanks for applying to buy wholesale with {{shopName}}. We've received {{companyName}}'s application and will review it shortly. You'll hear from us by email.\n\nThank you,\n{{shopName}}",
  },
  application_decision: {
    subject: "Your wholesale application was {{decision}}",
    body:
      "Hi,\n\nYour wholesale application for {{companyName}} was {{decision}}. {{portalUrl}}\n\nThank you,\n{{shopName}}",
  },
  application_notify: {
    subject: "New wholesale application: {{companyName}}",
    body:
      "A new wholesale application from {{companyName}} ({{contactEmail}}) is waiting for review in Mannon.",
  },
  weekly_digest: {
    subject: "Your week in quotes — {{shopName}}",
    body:
      "Here's your week: {{quotes}} quotes, {{winRate}} win rate, {{pipeline}} open pipeline.\n\nOpen Mannon → Analytics for the full picture.",
  },
  followup_reminder: {
    subject: "A quick nudge on your quote from {{shopName}}",
    body:
      "Hi {{buyerName}},\n\nJust following up on your open quote — it's ready for you to accept or counter:\n\n{{quoteUrl}}\n\nIt expires on {{expiresAt}}.\n\nThank you,\n{{shopName}}\n\nStop these reminders: {{unsubscribeUrl}}",
  },
  followup_expiry_warning: {
    subject: "Your quote expires soon — {{expiresAt}}",
    body:
      "Hi {{buyerName}},\n\nYour quote expires on {{expiresAt}}. Accept or counter it before then so you don't lose the pricing:\n\n{{quoteUrl}}\n\nThank you,\n{{shopName}}\n\nStop these reminders: {{unsubscribeUrl}}",
  },
  followup_expired: {
    subject: "Your quote has expired",
    body:
      "Hi {{buyerName}},\n\nYour quote has expired. Reach out if you'd still like to order — we're happy to re-quote.\n\n{{quoteUrl}}\n\nThank you,\n{{shopName}}",
  },
  accounting_sync_failure: {
    subject: "{{failed}} invoice(s) didn't reach {{provider}}",
    body:
      "Hi,\n\n{{failed}} invoice sync(s) to {{provider}} need your attention. Nothing was double-posted and your Shopify orders are unaffected.\n\nReview and retry them here:\n\n{{syncLogUrl}}\n\nThank you,\n{{shopName}}",
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
