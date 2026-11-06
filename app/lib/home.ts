// Home (App Home "homepage" pattern, docs/ux-audit.md). Two pure builders the
// route renders and the tests pin down:
//
//  - attentionItems(): the "Needs your attention" list — one row per inbox that
//    has work waiting, with a count and the link that opens that inbox. This is
//    job #1 (answer buyers who want a price), so it sits at the top of Home.
//  - setupSteps(): the setup guide that replaces the 12 onboarding banners that
//    used to stack on top of Settings. Core steps first, then optional ones for
//    features that are switched on. Progress = done / total.
//
// Client-safe: no server imports.

export interface AttentionCounts {
  requests: number; // storefront requests waiting for a reply (NEW)
  quotesToPrice: number; // buyer quotes waiting for the merchant (SUBMITTED)
  expiringSoon: number; // open quotes that expire in the next few days
  offers: number; // Make-an-Offer offers waiting (PENDING)
  applications: number; // wholesale applications waiting (PENDING / MORE_INFO)
  accessRequests: number; // shareable-catalog access requests (NEW)
  overdueInvoices: number; // net-terms invoices past due
  taxToVerify: number; // company tax profiles waiting for verification
}

export interface AttentionFlags {
  quoteRequests: boolean;
  offers: boolean;
  wholesale: boolean;
  catalogSharing: boolean;
  credit: boolean;
  tax: boolean;
}

export interface AttentionItem {
  id: keyof AttentionCounts;
  count: number;
  /** Plain-language line, already pluralised ("3 quotes to price"). */
  label: string;
  url: string;
  /** Short verb + noun for the row's action. */
  action: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Rows with work waiting, most urgent job first. Empty array = all caught up. */
export function attentionItems(c: AttentionCounts, f: AttentionFlags): AttentionItem[] {
  const rows: (AttentionItem | null)[] = [
    c.quotesToPrice > 0
      ? { id: "quotesToPrice", count: c.quotesToPrice, label: plural(c.quotesToPrice, "quote to price", "quotes to price"), url: "/app/quotes?view=needs-reply", action: "Price quotes" }
      : null,
    f.quoteRequests && c.requests > 0
      ? { id: "requests", count: c.requests, label: plural(c.requests, "storefront request to answer", "storefront requests to answer"), url: "/app/quote-requests", action: "Answer requests" }
      : null,
    f.offers && c.offers > 0
      ? { id: "offers", count: c.offers, label: plural(c.offers, "offer to review", "offers to review"), url: "/app/offers", action: "Review offers" }
      : null,
    c.expiringSoon > 0
      ? { id: "expiringSoon", count: c.expiringSoon, label: plural(c.expiringSoon, "quote expiring soon", "quotes expiring soon"), url: "/app/quotes?view=open", action: "View quotes" }
      : null,
    f.wholesale && c.applications > 0
      ? { id: "applications", count: c.applications, label: plural(c.applications, "wholesale application to review", "wholesale applications to review"), url: "/app/wholesale", action: "Review applications" }
      : null,
    f.catalogSharing && c.accessRequests > 0
      ? { id: "accessRequests", count: c.accessRequests, label: plural(c.accessRequests, "catalog access request", "catalog access requests"), url: "/app/catalog-sharing", action: "Review requests" }
      : null,
    f.credit && c.overdueInvoices > 0
      ? { id: "overdueInvoices", count: c.overdueInvoices, label: plural(c.overdueInvoices, "overdue invoice", "overdue invoices"), url: "/app/credit", action: "View invoices" }
      : null,
    f.tax && c.taxToVerify > 0
      ? { id: "taxToVerify", count: c.taxToVerify, label: plural(c.taxToVerify, "tax profile to verify", "tax profiles to verify"), url: "/app/tax", action: "Verify tax profiles" }
      : null,
  ];
  return rows.filter((r): r is AttentionItem => r !== null);
}

// --- setup guide ---------------------------------------------------------------

export interface SetupState {
  // feature switches (MANNON_FF_*), so optional steps only show for live features
  quoteWidget: boolean;
  catalogs: boolean;
  credit: boolean;
  tax: boolean;
  i18n: boolean;
  payments: boolean;
  erp: boolean;
  accounting: boolean;
  reps: boolean;
  catalogSharing: boolean;
  /** Growth or Scale — several optional steps need it. */
  growthTier: boolean;
  /** On a paid plan (not Free / not the unpaid trial). */
  onPaidPlan: boolean;
  // progress signals from the database
  hasQuoteWidget: boolean;
  hasBuyer: boolean;
  hasSentQuote: boolean;
  hasCustomCatalog: boolean;
  hasCreditProfile: boolean;
  hasTaxRules: boolean;
  hasI18nSetup: boolean;
  hasDepositPolicy: boolean;
  hasErpConnection: boolean;
  hasAccountingConnection: boolean;
  hasRep: boolean;
  hasPublicCatalog: boolean;
}

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  optional: boolean;
  action: { content: string; url: string };
}

export function setupSteps(s: SetupState): SetupStep[] {
  const steps: SetupStep[] = [];
  const add = (step: SetupStep) => steps.push(step);
  // Core path — the loop every merchant needs (storefront → buyer → quote → plan).
  if (s.quoteWidget) {
    add({
      id: "storefront",
      title: "Add the Request a Quote button to your store",
      description: "Buyers ask for a quote from any product page. The theme editor opens with the block already placed, and nothing changes until you save.",
      done: s.hasQuoteWidget,
      optional: false,
      action: { content: "Set up the button", url: "/app/quote-requests?setup=1" },
    });
  }
  add({
    id: "buyer",
    title: "Invite your first buyer",
    description: "Buyers come from your Shopify B2B companies. Send one a passwordless sign-in link to their portal.",
    done: s.hasBuyer,
    optional: false,
    action: { content: "Go to buyers", url: "/app/buyers" },
  });
  add({
    id: "quote",
    title: "Send your first quote",
    description: "Price a buyer's request and send a counter. Shopify calculates the totals.",
    done: s.hasSentQuote,
    optional: false,
    action: { content: "Open quotes", url: "/app/quotes" },
  });
  add({
    id: "plan",
    title: "Choose a plan",
    description: "Pick the plan that fits your volume. Billing is handled by Shopify.",
    done: s.onPaidPlan,
    optional: false,
    action: { content: "Compare plans", url: "/app/plans" },
  });
  // Optional — only for features that are switched on, in the order merchants need them.
  if (s.catalogs) add({ id: "catalog", title: "Build a custom catalog", description: "Show each company only the products they're allowed to see.", done: s.hasCustomCatalog, optional: true, action: { content: "Build a catalog", url: "/app/catalogs" } });
  if (s.credit) add({ id: "credit", title: "Set a credit profile", description: "Give a company a credit limit and net terms so orders on terms raise an invoice with a due date.", done: s.hasCreditProfile, optional: true, action: { content: "Set credit", url: "/app/credit" } });
  if (s.tax) add({ id: "tax", title: "Set your tax rules", description: "Collect exemption certificates and verify buyers. Shopify calculates the tax.", done: s.hasTaxRules, optional: true, action: { content: "Set tax rules", url: "/app/tax" } });
  if (s.i18n) add({ id: "i18n", title: "Add languages and currencies", description: "Let buyers use the portal in their language and see prices in their currency.", done: s.hasI18nSetup, optional: true, action: { content: "Add languages", url: "/app/i18n" } });
  if (s.payments && s.growthTier) add({ id: "deposit", title: "Set a default deposit", description: "Pre-fill a deposit percentage for large orders. Payment runs through Shopify checkout.", done: s.hasDepositPolicy, optional: true, action: { content: "Set a deposit", url: "/app/payments" } });
  if (s.reps && s.growthTier) add({ id: "reps", title: "Invite your sales reps", description: "Give reps a login scoped to the accounts they look after.", done: s.hasRep, optional: true, action: { content: "Invite reps", url: "/app/reps" } });
  if (s.catalogSharing && s.growthTier) add({ id: "share", title: "Publish a shareable catalog", description: "A public page new buyers can browse and request access to. Prices stay hidden until you approve them.", done: s.hasPublicCatalog, optional: true, action: { content: "Publish a catalog", url: "/app/catalog-sharing" } });
  if (s.erp && s.growthTier) add({ id: "erp", title: "Connect your ERP", description: "Keep stock accurate and send orders to your ERP or warehouse.", done: s.hasErpConnection, optional: true, action: { content: "Connect ERP", url: "/app/erp" } });
  if (s.accounting && s.growthTier) add({ id: "accounting", title: "Connect your accounting", description: "Send invoices and payments to QuickBooks Online or Xero.", done: s.hasAccountingConnection, optional: true, action: { content: "Connect accounting", url: "/app/accounting" } });
  return steps;
}

export function setupProgress(steps: SetupStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}
