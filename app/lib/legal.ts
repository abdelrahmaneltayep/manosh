// Privacy-policy content (S18). A Privacy Policy URL is mandatory for the
// Shopify App Store listing, and reviewers open it. The copy lives here as pure
// data so it's testable without a DOM and stays truthful to what the app
// actually does (mirrors /docs/compliance.md and the data model).

export interface LegalSection {
  heading: string;
  /** Paragraphs; a leading "• " marks a bullet line. */
  body: string[];
}

export const PRIVACY_LAST_UPDATED = "2026-07-20";
export const SUPPORT_EMAIL = "support@mannon.app";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "Who we are",
    body: [
      "Mannon is an embedded Shopify app that helps merchants using Shopify's native B2B run wholesale quotes and one-tap reorders. This policy explains what data Mannon accesses, why, and how it is protected.",
    ],
  },
  {
    heading: "What we access from Shopify",
    body: [
      "Mannon requests the minimum permissions its features need, and nothing more:",
      "• Products and prices (read) — to show buyers your catalog and match pasted orders.",
      "• Past orders (read) — to offer one-tap reorders of previous purchases.",
      "• B2B companies and locations (read) — to attach quotes and orders to the right account.",
      "• Payment terms (read) — to display and attach your existing terms to an order.",
      "• Draft orders (read and write) — to create the priced draft order when a quote is accepted.",
      "Shopify calculates every total, tax, and discount. Mannon never computes money itself — it only stores a snapshot of what Shopify returns.",
    ],
  },
  {
    heading: "What we store",
    body: [
      "• Your store domain and app settings (quote expiry, reorder tolerance).",
      "• Companies and buyers, including a buyer's name and email, so they can sign in to the buyer portal.",
      "• Quotes, their line items, and the totals snapshot Shopify returned.",
      "• An append-only activity log used for your dashboard and product analytics. These records contain only ids and numbers — never buyer names, emails, or other personal details.",
      "Buyer sign-in links are passwordless and single-use. We store only a hashed form of each link token, never the raw token.",
    ],
  },
  {
    heading: "Service providers",
    body: [
      "Mannon relies on a small set of processors:",
      "• Shopify — the platform your store and this app run on.",
      "• Product analytics and error monitoring — optional and, when enabled, receive only your store id, event names, and diagnostic data. Buyer personal data is never sent to them.",
      "• AI order parsing (Anthropic) — used only when you paste an order into the Magic Order Pad. Only that pasted text and your catalog are sent, at temperature zero, and the result is always shown for your confirmation before anything is created.",
    ],
  },
  {
    heading: "How we protect your data",
    body: [
      "• Every Shopify webhook is verified with an HMAC signature before it is processed; unsigned requests are rejected.",
      "• Buyer portal links are single-use, expiring, and stored hashed.",
      "• Mannon never sells your data or your buyers' data.",
    ],
  },
  {
    heading: "Data retention and deletion",
    body: [
      "Mannon honours Shopify's privacy webhooks. When Shopify sends a customer data-request, customer-redact, or shop-redact notification, Mannon responds accordingly — returning or deleting the relevant records. Uninstalling the app triggers cleanup of your store's data. To request deletion at any time, contact us at the address below.",
    ],
  },
  {
    heading: "Contact & support",
    body: [
      `Questions about this policy or your data? Email ${SUPPORT_EMAIL} and we'll help.`,
    ],
  },
];
