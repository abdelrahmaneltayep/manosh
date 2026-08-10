import { describe, it, expect } from "vitest";
import {
  navFlags,
  visibleNavParents,
  firstEnabledTabUrl,
  SECTION_GROUPS,
  GROUP_OF_TAB,
  type NavFlags,
} from "./nav";

const ALL_ON: NavFlags = {
  quoteRequests: true, quoteForms: true, priceRules: true, offers: true, followups: true,
  analytics: true, reps: true, wholesale: true, priceLists: true, catalogs: true,
  catalogSharing: true, orderRules: true, payments: true, credit: true, tax: true,
  i18n: true, erp: true, accounting: true, agency: true,
};
const ALL_OFF: NavFlags = Object.fromEntries(
  Object.keys(ALL_ON).map((k) => [k, false]),
) as unknown as NavFlags;

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

describe("merged IA — visibleNavParents (22 pages → 7)", () => {
  it("shows exactly the 7 parents when every flag is on", () => {
    const labels = visibleNavParents(ALL_ON).map((p) => p.label);
    expect(labels).toEqual([
      "Quotes",
      "Quote forms",
      "Pricing & catalog",
      "Buyers",
      "Analytics",
      "Settings",
      "Pricing plans",
    ]);
  });

  it("each parent links to its first enabled tab (never a 404)", () => {
    const byLabel = Object.fromEntries(visibleNavParents(ALL_ON).map((p) => [p.label, p.url]));
    expect(byLabel["Quotes"]).toBe("/app/quotes");
    expect(byLabel["Quote forms"]).toBe("/app/quote-forms");
    expect(byLabel["Pricing & catalog"]).toBe("/app/price-rules");
    expect(byLabel["Buyers"]).toBe("/app/buyers");
    expect(byLabel["Settings"]).toBe("/app/settings");
    expect(byLabel["Pricing plans"]).toBe("/app/plans");
  });

  it("hides a flag-gated group entirely when all its tabs are off", () => {
    // forms group = quote-forms + languages, both flagged
    const flags = { ...ALL_OFF, quoteForms: false, i18n: false };
    const labels = visibleNavParents(flags).map((p) => p.label);
    expect(labels).not.toContain("Quote forms");
    expect(labels).not.toContain("Pricing & catalog"); // all pricing tabs off too
  });

  it("keeps core parents (Quotes/Buyers/Settings/Pricing plans) even with all flags off", () => {
    const labels = visibleNavParents(ALL_OFF).map((p) => p.label);
    expect(labels).toEqual(["Quotes", "Buyers", "Settings", "Pricing plans"]);
  });

  it("points a group at its first ENABLED tab when the default tab's flag is off", () => {
    // forms: quote-forms off, languages on → parent should land on Languages
    const flags = { ...ALL_OFF, i18n: true };
    const forms = visibleNavParents(flags).find((p) => p.label === "Quote forms");
    expect(forms?.url).toBe("/app/i18n");
  });

  it("Analytics is standalone — shown only when its flag is on", () => {
    expect(visibleNavParents(ALL_OFF).some((p) => p.label === "Analytics")).toBe(false);
    expect(visibleNavParents({ ...ALL_OFF, analytics: true }).some((p) => p.label === "Analytics")).toBe(true);
  });
});

describe("firstEnabledTabUrl", () => {
  it("returns the first on tab; null when the group is fully off", () => {
    expect(firstEnabledTabUrl("pricing", ALL_ON)).toBe("/app/price-rules");
    expect(firstEnabledTabUrl("pricing", { ...ALL_OFF, offers: true })).toBe("/app/offers");
    expect(firstEnabledTabUrl("pricing", ALL_OFF)).toBeNull();
    expect(firstEnabledTabUrl("nope", ALL_ON)).toBeNull();
  });
});

describe("SECTION_GROUPS integrity (tab bar ↔ nav share one source)", () => {
  it("all 22 old pages are represented across the 5 tabbed groups + 2 standalone", () => {
    const tabIds = Object.values(SECTION_GROUPS).flat().map((t) => t.id);
    // 3 quotes + 2 forms + 7 pricing + 3 buyers + 6 settings = 21 tabs; Analytics
    // + Pricing plans are the 2 standalone parents (not tabs).
    expect(tabIds.length).toBe(21);
    expect(new Set(tabIds).size).toBe(21); // no dup ids
  });

  it("GROUP_OF_TAB resolves every tab id back to its group", () => {
    for (const [group, tabs] of Object.entries(SECTION_GROUPS)) {
      for (const t of tabs) expect(GROUP_OF_TAB[t.id]).toBe(group);
    }
  });
});
