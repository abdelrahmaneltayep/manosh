import { describe, it, expect } from "vitest";
import { navFlags } from "./nav";

describe("navFlags", () => {
  it("hides every flagged feature when nothing is set", () => {
    const f = navFlags({});
    expect(Object.values(f).every((v) => v === false)).toBe(true);
  });

  it("shows a feature only when its exact flag is 'true'", () => {
    expect(navFlags({ MANNON_FF_MAKE_AN_OFFER: "true" }).offers).toBe(true);
    expect(navFlags({ MANNON_FF_MAKE_AN_OFFER: "1" }).offers).toBe(false);
    expect(navFlags({ MANNON_FF_MAKE_AN_OFFER: "false" }).offers).toBe(false);
    expect(navFlags({}).offers).toBe(false);
  });

  it("maps quote-forms and price-rules to the shared capture flag", () => {
    const f = navFlags({ MANNON_FF_QUOTE_CAPTURE: "true" });
    expect(f.quoteForms).toBe(true);
    expect(f.priceRules).toBe(true);
    expect(f.offers).toBe(false);
  });

  it("all flags on → every nav item visible", () => {
    const env: Record<string, string> = {};
    for (const k of [
      "MANNON_FF_QUOTE_WIDGET", "MANNON_FF_QUOTE_CAPTURE", "MANNON_FF_MAKE_AN_OFFER",
      "MANNON_FF_FOLLOWUPS", "MANNON_FF_QUOTE_ANALYTICS", "MANNON_FF_REP_PORTAL",
      "MANNON_FF_WHOLESALE_REG", "MANNON_FF_PRICELISTS", "MANNON_FF_CUSTOM_CATALOGS",
      "MANNON_FF_CATALOG_SHARE", "MANNON_FF_MOQ", "MANNON_FF_FLEX_PAY", "MANNON_FF_CREDIT",
      "MANNON_FF_TAX_VAT", "MANNON_FF_I18N", "MANNON_FF_ERP_SYNC", "MANNON_FF_ACCOUNTING_SYNC",
      "MANNON_FF_WHITE_LABEL",
    ]) env[k] = "true";
    const f = navFlags(env);
    expect(Object.values(f).every((v) => v === true)).toBe(true);
  });
});
