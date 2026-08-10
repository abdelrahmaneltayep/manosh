// Which admin nav links to show. Every feature route below `throw`s a 404 (or
// renders a disabled state) when its flag is off; linking to a disabled one from
// the NavMenu makes the embedded app show "Something went wrong" on tab click
// (App Store review 2.1.1 — 404s are not acceptable). So the nav is rendered
// from the set of ENABLED features: a disabled feature is simply not linked.
//
// Core routes (Home, Quotes, Buyers, Settings) have no flag and never 404, so
// they're always in the nav and aren't listed here.

export interface NavFlags {
  quoteRequests: boolean;
  quoteForms: boolean;
  priceRules: boolean;
  offers: boolean;
  followups: boolean;
  analytics: boolean;
  reps: boolean;
  wholesale: boolean;
  priceLists: boolean;
  catalogs: boolean;
  catalogSharing: boolean;
  orderRules: boolean;
  payments: boolean;
  credit: boolean;
  tax: boolean;
  i18n: boolean;
  erp: boolean;
  accounting: boolean;
  agency: boolean;
}

/** Resolve nav visibility from the feature-flag env. Pure + unit-tested. Each key
 *  maps to the exact flag the matching route checks, so the nav can never link to
 *  a route that would 404. */
export function navFlags(env: Record<string, string | undefined>): NavFlags {
  const on = (k: string) => env[k] === "true";
  return {
    quoteRequests: on("MANNON_FF_QUOTE_WIDGET"),
    quoteForms: on("MANNON_FF_QUOTE_CAPTURE"),
    priceRules: on("MANNON_FF_QUOTE_CAPTURE"),
    offers: on("MANNON_FF_MAKE_AN_OFFER"),
    followups: on("MANNON_FF_FOLLOWUPS"),
    analytics: on("MANNON_FF_QUOTE_ANALYTICS"),
    reps: on("MANNON_FF_REP_PORTAL"),
    wholesale: on("MANNON_FF_WHOLESALE_REG"),
    priceLists: on("MANNON_FF_PRICELISTS"),
    catalogs: on("MANNON_FF_CUSTOM_CATALOGS"),
    catalogSharing: on("MANNON_FF_CATALOG_SHARE"),
    orderRules: on("MANNON_FF_MOQ"),
    payments: on("MANNON_FF_FLEX_PAY"),
    credit: on("MANNON_FF_CREDIT"),
    tax: on("MANNON_FF_TAX_VAT"),
    i18n: on("MANNON_FF_I18N"),
    erp: on("MANNON_FF_ERP_SYNC"),
    accounting: on("MANNON_FF_ACCOUNTING_SYNC"),
    agency: on("MANNON_FF_WHITE_LABEL"),
  };
}

// --- merged information architecture (NAV-MIGRATION.md) -----------------------
// The 22 old pages fold into 7 nav parents; each old page becomes a tab. This
// data is the single source of truth for BOTH the in-page tab bar (SectionTabs)
// and the left-nav (visibleNavParents), so they can never drift apart.

export interface SectionTab {
  /** Stable id; matches the page's `<SectionTabs active="…" />`. */
  id: string;
  label: string;
  url: string;
  /** Feature-flag gate; omit for always-on core tabs (Quotes, Buyers, General). */
  flag?: keyof NavFlags;
}

/** Tabs per parent group, in display order. First entry = the group's default. */
export const SECTION_GROUPS: Record<string, SectionTab[]> = {
  quotes: [
    { id: "quotes", label: "Quotes", url: "/app/quotes" },
    { id: "requests", label: "Requests", url: "/app/quote-requests", flag: "quoteRequests" },
    { id: "followups", label: "Follow-ups", url: "/app/followups", flag: "followups" },
  ],
  forms: [
    { id: "quote-forms", label: "Quote forms", url: "/app/quote-forms", flag: "quoteForms" },
    { id: "languages", label: "Languages", url: "/app/i18n", flag: "i18n" },
  ],
  pricing: [
    { id: "price-rules", label: "Price rules", url: "/app/price-rules", flag: "priceRules" },
    { id: "price-lists", label: "Price lists", url: "/app/price-lists", flag: "priceLists" },
    { id: "offers", label: "Offers", url: "/app/offers", flag: "offers" },
    { id: "wholesale", label: "Wholesale", url: "/app/wholesale", flag: "wholesale" },
    { id: "catalogs", label: "Catalogs", url: "/app/catalogs", flag: "catalogs" },
    { id: "catalog-sharing", label: "Catalog sharing", url: "/app/catalog-sharing", flag: "catalogSharing" },
    { id: "order-rules", label: "Order rules", url: "/app/order-rules", flag: "orderRules" },
  ],
  buyers: [
    { id: "buyers", label: "Buyers", url: "/app/buyers" },
    { id: "reps", label: "Reps", url: "/app/reps", flag: "reps" },
    { id: "credit", label: "Credit", url: "/app/credit", flag: "credit" },
  ],
  settings: [
    { id: "general", label: "General", url: "/app/settings" },
    { id: "payments", label: "Payments", url: "/app/payments", flag: "payments" },
    { id: "tax", label: "Tax & VAT", url: "/app/tax", flag: "tax" },
    { id: "erp", label: "ERP sync", url: "/app/erp", flag: "erp" },
    { id: "accounting", label: "Accounting", url: "/app/accounting", flag: "accounting" },
    { id: "agency", label: "Agency", url: "/app/agency", flag: "agency" },
  ],
};

/** Which group a tab id belongs to. */
export const GROUP_OF_TAB: Record<string, string> = Object.fromEntries(
  Object.entries(SECTION_GROUPS).flatMap(([group, tabs]) => tabs.map((t) => [t.id, group])),
);

interface NavParentDef {
  label: string;
  /** A tabbed group (from SECTION_GROUPS) … */
  group?: string;
  /** … or a standalone page (with its own flag + url). */
  url?: string;
  flag?: keyof NavFlags;
}

/** The 7 top-level nav parents, in order. Home (rel="home") is added separately
 *  in the NavMenu — App Bridge requires it and it isn't one of the seven. */
const NAV_PARENTS: NavParentDef[] = [
  { label: "Quotes", group: "quotes" },
  { label: "Quote forms", group: "forms" },
  { label: "Pricing & catalog", group: "pricing" },
  { label: "Buyers", group: "buyers" },
  { label: "Analytics", url: "/app/analytics", flag: "analytics" },
  { label: "Settings", group: "settings" },
  { label: "Pricing plans", url: "/app/plans" },
];

/** The first enabled tab URL in a group (for parent-alias redirects like
 *  /app/pricing → the first visible pricing tab). null when the group is empty or
 *  entirely flag-disabled. */
export function firstEnabledTabUrl(group: string, flags: NavFlags): string | null {
  const tabs = SECTION_GROUPS[group];
  if (!tabs) return null;
  const enabled = tabs.filter((t) => !t.flag || flags[t.flag]);
  return enabled[0]?.url ?? null;
}

/** The nav links to render, resolved against the feature flags. A tabbed parent
 *  shows when ≥1 of its tabs is enabled and links to its first enabled tab (so
 *  the nav never points at a 404). A standalone parent shows when its flag is on
 *  (or always, if it has none). */
export function visibleNavParents(flags: NavFlags): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  for (const p of NAV_PARENTS) {
    if (p.group) {
      const enabled = SECTION_GROUPS[p.group].filter((t) => !t.flag || flags[t.flag]);
      if (enabled.length > 0) out.push({ label: p.label, url: enabled[0].url });
    } else if (p.flag) {
      if (flags[p.flag]) out.push({ label: p.label, url: p.url! });
    } else {
      out.push({ label: p.label, url: p.url! });
    }
  }
  return out;
}
