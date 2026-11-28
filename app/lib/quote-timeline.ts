// The quote page's timeline, like Shopify's order timeline: what happened to
// this quote, newest first, in plain words. Built from the append-only Event
// log and the email delivery log. Pure and client-safe.

export interface TimelineSourceEvent {
  type: string;
  createdAt: string | Date;
  payload?: unknown;
}

export interface TimelineSourceEmail {
  to: string;
  template: string | null;
  status: "SENT" | "FAILED" | "SKIPPED";
  error: string | null;
  createdAt: string | Date;
}

export interface TimelineEntry {
  at: string;
  text: string;
  tone?: "critical";
}

const EVENT_TEXT: Record<string, string> = {
  QUOTE_SUBMITTED: "Quote requested",
  QUOTE_IMPORTED: "Quote imported",
  QUOTE_DUPLICATED: "Quote created as a copy",
  QUOTE_COUNTERED: "Quote sent to the buyer",
  QUOTE_ACCEPTED: "Buyer accepted the quote",
  QUOTE_CONVERTED: "Converted to a draft order",
  DRAFT_ORDER_CREATED: "Draft order created in Shopify",
  QUOTE_ORDERED: "Order placed",
  QUOTE_EXPIRED: "Quote expired",
  ORDER_APPROVED: "Order approved by the buyer’s company",
  ORDER_PLACED_ON_BEHALF: "Placed by a sales rep",
  PAYMENT_PLAN_CREATED: "Payment plan set up",
  PAYLINK_PAID: "Payment received",
  FOLLOWUP_SENT: "Follow-up sent",
};

const EMAIL_TEXT: Record<string, string> = {
  quote_sent: "Quote email",
  quote_ordered: "Order email",
  quote_request_ack: "“Request received” email",
  quote_pdf: "Quote PDF",
};

export function buildTimeline(events: TimelineSourceEvent[], emails: TimelineSourceEmail[]): TimelineEntry[] {
  const iso = (d: string | Date) => new Date(d).toISOString();
  const rows: TimelineEntry[] = [];
  for (const e of events) {
    const text = EVENT_TEXT[e.type];
    if (!text) continue;
    // A quote that came from the storefront says so.
    const fromRequest = e.type === "QUOTE_SUBMITTED" && (e.payload as { requestId?: string } | null)?.requestId;
    rows.push({ at: iso(e.createdAt), text: fromRequest ? "Quote requested from your store" : text });
  }
  for (const m of emails) {
    if (m.status === "SKIPPED") continue;
    const what = (m.template && EMAIL_TEXT[m.template]) || (m.template?.startsWith("followup_") ? "Reminder email" : "Email");
    rows.push(
      m.status === "SENT"
        ? { at: iso(m.createdAt), text: `${what} sent to ${m.to}` }
        : { at: iso(m.createdAt), text: `${what} to ${m.to} wasn’t delivered${m.error ? `: ${m.error.replace(/[.\s]+$/, "")}` : ""}`, tone: "critical" },
    );
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
