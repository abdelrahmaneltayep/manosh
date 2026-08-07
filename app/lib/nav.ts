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
