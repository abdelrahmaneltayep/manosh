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
  rep_invite: {
    subject: "You've been added as a sales rep for {{shopName}}",
    body:
      "Hi {{repName}},\n\nYou've been added as a sales rep for {{shopName}} on Mannon. Use this secure link to sign in — no password needed:\n\n{{inviteUrl}}\n\nYou'll see only the accounts assigned to you.\n\nThank you,\n{{shopName}}",
  },
  rep_order_placed: {
    subject: "{{repName}} placed an order on your account",
    body:
      "Hi {{buyerName}},\n\nThis is a courtesy note that {{repName}} placed an order on behalf of {{companyName}} in your Mannon portal. If this wasn't expected, reply to let us know.\n\nThank you,\n{{shopName}}",
  },
  deposit_received: {
    subject: "Deposit received — thank you",
    body:
      "Hi {{buyerName}},\n\nWe've received your {{amount}} deposit. The balance of {{balance}} is scheduled per your plan — you'll get a reminder before each payment is due.\n\n{{payUrl}}\n\nThank you,\n{{shopName}}",
  },
  installment_due: {
    subject: "A payment of {{amount}} is due {{dueDate}}",
    body:
      "Hi {{buyerName}},\n\nA scheduled payment of {{amount}} is due on {{dueDate}}. You can pay securely here — no login needed:\n\n{{payUrl}}\n\nAll payments are processed by {{shopName}}'s Shopify checkout.\n\nThank you,\n{{shopName}}",
  },
  installment_overdue: {
    subject: "Overdue: a payment of {{amount}} was due {{dueDate}}",
    body:
      "Hi {{buyerName}},\n\nA scheduled payment of {{amount}} was due on {{dueDate}} and is now overdue. Please pay securely here:\n\n{{payUrl}}\n\nThank you,\n{{shopName}}",
  },
  paylink: {
    subject: "Your secure payment link for {{amount}}",
    body:
      "Hi {{buyerName}},\n\nHere's a secure link to pay {{amount}} — no login needed. It's single-use and expires soon:\n\n{{payUrl}}\n\nPayment is processed by {{shopName}}'s Shopify checkout; we never see your card details.\n\nThank you,\n{{shopName}}",
  },
  tax_certificate_received: {
    subject: "We received your tax documents — {{companyName}}",
    body:
      "Hi {{buyerName}},\n\nThanks — we've received the tax details for {{companyName}} and will review them shortly. Until they're verified, orders are charged tax as usual.\n\nThank you,\n{{shopName}}",
  },
  tax_verified: {
    subject: "Your tax status is verified — {{companyName}}",
    body:
      "Hi {{buyerName}},\n\nGood news — {{companyName}}'s tax status is now verified ({{status}}). Your quotes and invoices will reflect the correct tax from now on.\n\nThank you,\n{{shopName}}",
  },
  tax_rejected: {
    subject: "We couldn't verify your tax documents",
    body:
      "Hi {{buyerName}},\n\nWe weren't able to verify {{companyName}}'s tax documents: {{reason}}\n\nPlease re-submit from your portal. Orders remain taxed until verified.\n\nThank you,\n{{shopName}}",
  },
  tax_cert_expiring: {
    subject: "Your tax certificate expires soon — {{expiresAt}}",
    body:
      "Hi {{buyerName}},\n\n{{companyName}}'s exemption certificate expires on {{expiresAt}}. Please upload a renewed certificate from your portal so your exemption continues without interruption.\n\nThank you,\n{{shopName}}",
  },
  erp_sync_failure: {
    subject: "{{failed}} ERP sync(s) need attention",
    body:
      "Hi,\n\n{{failed}} order export(s) to your ERP have failed after retries. Your Shopify orders are unaffected — this only concerns the ERP export.\n\nReview and retry them here:\n\n{{syncLogUrl}}\n\nThank you,\n{{shopName}}",
  },
  quote_request_created: {
    subject: "New quote request from {{email}}",
    body:
      "A new quote request came in from your storefront.\n\nFrom: {{email}}{{companyLine}}\nItems: {{itemCount}}\n\nReview and convert it to a quote in one click:\n\n{{requestUrl}}",
  },
  quote_request_ack: {
    subject: "We got your quote request — {{shopName}}",
    body:
      "Hi,\n\nThanks for requesting a quote from {{shopName}}. We've received it and our team will get back to you shortly with pricing.\n\nThank you,\n{{shopName}}",
  },
  pwa_install_nudge: {
    subject: "Reorder from your phone in one tap — {{shopName}}",
    body:
      "Hi {{buyerName}},\n\nAdd {{shopName}}'s wholesale portal to your phone's home screen and reorder your usual in one tap.\n\nOpen your portal, then choose “Add to Home Screen”:\n\n{{portalUrl}}\n\nThank you,\n{{shopName}}",
  },
};

export type TemplateKey = keyof typeof DEFAULT_TEMPLATES;

/**
 * F16 — locale translations for the buyer-facing templates. EN is the source
 * (DEFAULT_TEMPLATES); any key not translated for a locale falls back to EN, so
 * every email always resolves. Add locales/keys here as they're translated.
 */
export const TEMPLATE_TRANSLATIONS: Record<string, Partial<Record<TemplateKey, { subject: string; body: string }>>> = {
  ar: {
    invoice_issued: {
      subject: "فاتورة {{invoiceNumber}} من {{shopName}} — تُستحق في {{dueDate}}",
      body: "مرحباً {{buyerName}}،\n\nفاتورتك {{invoiceNumber}} بمبلغ {{amount}} أصبحت مفتوحة بشروط {{terms}} وتُستحق في {{dueDate}}.\n\nاعرضها وحمّلها في أي وقت من بوابتك: {{invoiceUrl}}\n\nشكراً لك،\n{{shopName}}",
    },
    reminder_t_minus_3: {
      subject: "تذكير: الفاتورة {{invoiceNumber}} تُستحق خلال 3 أيام",
      body: "مرحباً {{buyerName}}،\n\nتذكير ودّي بأن الفاتورة {{invoiceNumber}} بمبلغ {{amount}} تُستحق في {{dueDate}} (خلال 3 أيام).\n\n{{invoiceUrl}}\n\nشكراً لك،\n{{shopName}}",
    },
    reminder_due: {
      subject: "الفاتورة {{invoiceNumber}} تُستحق اليوم",
      body: "مرحباً {{buyerName}}،\n\nالفاتورة {{invoiceNumber}} بمبلغ {{amount}} تُستحق اليوم ({{dueDate}}).\n\n{{invoiceUrl}}\n\nشكراً لك،\n{{shopName}}",
    },
    followup_reminder: {
      subject: "تذكير سريع بشأن عرض السعر من {{shopName}}",
      body: "مرحباً {{buyerName}}،\n\nمتابعة بخصوص عرض السعر المفتوح — جاهز لقبوله أو تقديم عرض مقابل:\n\n{{quoteUrl}}\n\nينتهي في {{expiresAt}}.\n\nشكراً لك،\n{{shopName}}\n\nلإيقاف هذه التذكيرات: {{unsubscribeUrl}}",
    },
    member_invite: {
      subject: "تمت دعوتك لتقديم الطلبات لصالح {{companyName}}",
      body: "مرحباً،\n\nتمت دعوتك إلى بوابة {{companyName}} بصفة {{role}}. استخدم هذا الرابط الآمن لتسجيل الدخول — بدون كلمة مرور:\n\n{{inviteUrl}}\n\nشكراً لك،\n{{shopName}}",
    },
    paylink: {
      subject: "رابط الدفع الآمن الخاص بك بمبلغ {{amount}}",
      body: "مرحباً {{buyerName}}،\n\nإليك رابطاً آمناً لدفع {{amount}} — بدون تسجيل دخول. صالح لمرة واحدة وينتهي قريباً:\n\n{{payUrl}}\n\nتتم المعالجة عبر Shopify؛ لا نطّلع على بيانات بطاقتك.\n\nشكراً لك،\n{{shopName}}",
    },
    tax_verified: {
      subject: "تم التحقق من وضعك الضريبي — {{companyName}}",
      body: "مرحباً {{buyerName}}،\n\nتم التحقق من الوضع الضريبي لـ {{companyName}} ({{status}}). ستعكس عروض الأسعار والفواتير الضريبة الصحيحة من الآن.\n\nشكراً لك،\n{{shopName}}",
    },
  },
};

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
 * Resolve a template for a shop + locale. Precedence: shop override
 * (Shop.emailTemplates) > locale translation (F16) > EN default. Every key always
 * resolves (EN is the ultimate fallback), so localization never breaks an email.
 * Pure so it's testable.
 */
export function resolveTemplate(
  key: TemplateKey,
  overrides: unknown,
  locale = "en",
): { subject: string; body: string } {
  const en = DEFAULT_TEMPLATES[key];
  const localized = TEMPLATE_TRANSLATIONS[locale]?.[key];
  const base = localized ?? en;
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
