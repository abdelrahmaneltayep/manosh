// Email templates, organised for the Notifications page (Shopify's own
// Settings → Notifications pattern: grouped rows → one page per template).
// Client-safe: labels and grouping only; defaults stay in mailer.server.ts.

export interface TemplateGroup {
  id: string;
  title: string;
  description: string;
  keys: string[];
}

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    id: "quotes",
    title: "Quotes and follow-ups",
    description: "Sent while a quote is open.",
    keys: ["quote_request_ack", "quote_request_created", "followup_reminder", "followup_expiry_warning", "followup_expired", "weekly_digest"],
  },
  {
    id: "payments",
    title: "Invoices and payments",
    description: "Net-terms invoices, reminders and payment plans.",
    keys: ["invoice_issued", "reminder_t_minus_3", "reminder_due", "reminder_overdue_7", "deposit_received", "installment_due", "installment_overdue", "paylink"],
  },
  {
    id: "buyers",
    title: "Buyers and team",
    description: "Invitations, approvals and reorder reminders.",
    keys: ["member_invite", "approval_request", "approval_decision", "reorder_list", "pwa_install_nudge", "rep_invite", "rep_order_placed"],
  },
  {
    id: "wholesale",
    title: "Wholesale applications and catalogs",
    description: "Sign-up applications and catalog access requests.",
    keys: ["application_received", "application_decision", "application_notify", "catalog_lead_created", "catalog_access_approved"],
  },
  {
    id: "tax",
    title: "Tax",
    description: "Exemption certificates and verification.",
    keys: ["tax_certificate_received", "tax_verified", "tax_rejected", "tax_cert_expiring"],
  },
  {
    id: "integrations",
    title: "Integrations and agency",
    description: "Sync problems and multi-store setup.",
    keys: ["accounting_sync_failure", "erp_sync_failure", "org_invite", "store_linked"],
  },
];

/** Plain-language name and who receives it. */
export const TEMPLATE_INFO: Record<string, { label: string; to: "Buyer" | "You" | "Team" | "Rep" | "Visitor" }> = {
  invoice_issued: { label: "Invoice issued", to: "Buyer" },
  reminder_t_minus_3: { label: "Payment reminder, 3 days before due", to: "Buyer" },
  reminder_due: { label: "Payment reminder, on the due date", to: "Buyer" },
  reminder_overdue_7: { label: "Payment reminder, 7 days overdue", to: "Buyer" },
  reorder_list: { label: "Reorder a saved list", to: "Buyer" },
  member_invite: { label: "Company member invite", to: "Buyer" },
  approval_request: { label: "Order approval request", to: "Buyer" },
  approval_decision: { label: "Order approval decision", to: "Buyer" },
  application_received: { label: "Application received", to: "Visitor" },
  application_decision: { label: "Application decision", to: "Visitor" },
  application_notify: { label: "New application", to: "You" },
  weekly_digest: { label: "Weekly quote summary", to: "You" },
  followup_reminder: { label: "Quote reminder", to: "Buyer" },
  followup_expiry_warning: { label: "Quote about to expire", to: "Buyer" },
  followup_expired: { label: "Quote expired", to: "Buyer" },
  accounting_sync_failure: { label: "Accounting sync problems", to: "You" },
  rep_invite: { label: "Sales rep invite", to: "Rep" },
  rep_order_placed: { label: "Order placed by your rep", to: "Buyer" },
  quote_request_created: { label: "New storefront request", to: "You" },
  quote_request_ack: { label: "Request received", to: "Visitor" },
  deposit_received: { label: "Deposit received", to: "Buyer" },
  installment_due: { label: "Installment due", to: "Buyer" },
  installment_overdue: { label: "Installment overdue", to: "Buyer" },
  paylink: { label: "Pay-by-link", to: "Buyer" },
  tax_certificate_received: { label: "Tax documents received", to: "Buyer" },
  tax_verified: { label: "Tax status verified", to: "Buyer" },
  tax_rejected: { label: "Tax documents rejected", to: "Buyer" },
  tax_cert_expiring: { label: "Tax certificate expiring", to: "Buyer" },
  erp_sync_failure: { label: "ERP sync problems", to: "You" },
  pwa_install_nudge: { label: "Install the buyer app", to: "Buyer" },
  catalog_lead_created: { label: "New catalog access request", to: "You" },
  catalog_access_approved: { label: "Catalog access approved", to: "Buyer" },
  org_invite: { label: "Agency workspace ready", to: "Team" },
  store_linked: { label: "Store linked to your agency", to: "Team" },
};

export type TemplateOverrides = Record<string, { subject?: string; body?: string }>;

/**
 * Set (or clear) one template's override. Only fields that differ from the
 * default are stored, so improved defaults keep flowing to everything the
 * merchant didn't change. Every other template's override is kept as-is
 * (the old Settings form only saved 15 of 34 keys and dropped the rest).
 */
export function mergeTemplateOverride(
  existing: TemplateOverrides,
  key: string,
  input: { subject: string; body: string } | null,
  defaults: { subject: string; body: string },
): TemplateOverrides {
  const next: TemplateOverrides = { ...existing };
  delete next[key];
  if (!input) return next; // reset to default
  const entry: { subject?: string; body?: string } = {};
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject && subject !== defaults.subject) entry.subject = subject;
  if (body && body !== defaults.body) entry.body = body;
  if (entry.subject || entry.body) next[key] = entry;
  return next;
}
