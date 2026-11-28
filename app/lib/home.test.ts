import { describe, it, expect } from "vitest";
import { attentionItems, guideSteps, setupSteps, setupProgress, storefrontStatus, SETUP_GUIDE_MAX, type AttentionCounts, type SetupState } from "./home";

const ZERO: AttentionCounts = { requests: 0, quotesToPrice: 0, expiringSoon: 0, offers: 0, applications: 0, accessRequests: 0, overdueInvoices: 0, taxToVerify: 0 };
const FLAGS_ON = { quoteRequests: true, offers: true, wholesale: true, catalogSharing: true, credit: true, tax: true };
const FLAGS_OFF = { quoteRequests: false, offers: false, wholesale: false, catalogSharing: false, credit: false, tax: false };

describe("attentionItems", () => {
  it("is empty when nothing is waiting (all caught up)", () => {
    expect(attentionItems(ZERO, FLAGS_ON)).toEqual([]);
  });

  it("lists quotes to price first and links each row to its inbox", () => {
    const rows = attentionItems({ ...ZERO, requests: 2, quotesToPrice: 1, overdueInvoices: 3 }, FLAGS_ON);
    expect(rows.map((r) => r.id)).toEqual(["quotesToPrice", "requests", "overdueInvoices"]);
    expect(rows[0]).toMatchObject({ label: "1 quote to price", url: "/app/quotes?view=needs-reply" });
    expect(rows[1].label).toBe("2 storefront requests to answer");
    expect(rows[2].url).toBe("/app/credit");
  });

  it("never links to a feature that is switched off", () => {
    const rows = attentionItems({ ...ZERO, requests: 2, offers: 1, applications: 4, quotesToPrice: 1 }, FLAGS_OFF);
    expect(rows.map((r) => r.id)).toEqual(["quotesToPrice"]);
  });
});

const BASE: SetupState = {
  quoteWidget: true, catalogs: false, credit: false, tax: false, i18n: false, payments: false, erp: false,
  accounting: false, reps: false, catalogSharing: false, growthTier: false, planSelected: false,
  hasQuoteWidget: false, hasBuyer: false, hasSentQuote: false, hasCustomCatalog: false, hasCreditProfile: false,
  hasTaxRules: false, hasI18nSetup: false, hasDepositPolicy: false, hasErpConnection: false,
  hasAccountingConnection: false, hasRep: false, hasPublicCatalog: false,
};

describe("setupSteps", () => {
  it("leads with the core loop: storefront → buyer → quote → plan", () => {
    const steps = setupSteps(BASE);
    expect(steps.map((s) => s.id)).toEqual(["storefront", "buyer", "quote", "plan"]);
    expect(steps.every((s) => !s.optional)).toBe(true);
  });

  it("offers optional steps only for live features the plan includes", () => {
    const flags = { credit: true, erp: true, reps: true, accounting: true };
    const starter = setupSteps({ ...BASE, ...flags }).map((s) => s.id);
    expect(starter).not.toContain("credit"); // credit control is Growth
    expect(starter).not.toContain("erp");
    const growth = setupSteps({ ...BASE, ...flags, growthTier: true }).map((s) => s.id);
    expect(growth).toContain("credit");
    // Reps, ERP and accounting are Scale.
    for (const id of ["erp", "reps", "accounting"]) expect(growth).not.toContain(id);
    const scale = setupSteps({ ...BASE, ...flags, growthTier: true, scaleTier: true });
    for (const id of ["erp", "reps", "accounting"]) expect(scale.map((s) => s.id)).toContain(id);
    expect(scale.find((s) => s.id === "erp")?.optional).toBe(true);
  });

  it("counts progress from the done flags", () => {
    const steps = setupSteps({ ...BASE, hasQuoteWidget: true, hasBuyer: true });
    expect(setupProgress(steps)).toEqual({ done: 2, total: 4, complete: false });
    const all = setupSteps({ ...BASE, hasQuoteWidget: true, hasBuyer: true, hasSentQuote: true, planSelected: true });
    expect(setupProgress(all).complete).toBe(true);
  });
});

describe("guideSteps (Built for Shopify: at most 5 tasks; Mannon shows 4)", () => {
  const everything = { ...BASE, catalogs: true, credit: true, tax: true, i18n: true, payments: true, erp: true, accounting: true, reps: true, catalogSharing: true, growthTier: true, scaleTier: true };

  it("never shows more than 4 tasks, core path first", () => {
    const steps = guideSteps(setupSteps(everything));
    expect(SETUP_GUIDE_MAX).toBe(4);
    expect(steps.map((s) => s.id)).toEqual(["storefront", "buyer", "quote", "plan"]);
  });

  it("fills a spare slot with an optional step when the button feature is off", () => {
    const steps = guideSteps(setupSteps({ ...everything, quoteWidget: false }));
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.id).slice(0, 3)).toEqual(["buyer", "quote", "plan"]);
    expect(steps[3].optional).toBe(true);
  });
});

describe("storefrontStatus", () => {
  const editor = "https://x.myshopify.com/admin/themes/current/editor?template=product&addAppBlockId=k/quote_button&target=mainSection";

  it("says the button is off and how to turn it on", () => {
    const s = storefrontStatus({ featureOn: true, buttonOn: false, lastRequestAt: null, themeEditorUrl: editor });
    expect(s?.label).toBe("Quote button: off");
    expect(s?.primary).toEqual({ content: "Turn on the button", url: "/app/quote-requests?setup=1" });
  });

  it("points to the theme editor when the button is on but no request has arrived", () => {
    const s = storefrontStatus({ featureOn: true, buttonOn: true, lastRequestAt: null, themeEditorUrl: editor });
    expect(s?.label).toBe("Quote button: on");
    expect(s?.primary).toEqual({ content: "Open theme editor", url: editor, external: true });
  });

  it("shows the last request as proof it is live", () => {
    const s = storefrontStatus({ featureOn: true, buttonOn: true, lastRequestAt: "2026-11-27T10:00:00.000Z", themeEditorUrl: editor });
    expect(s?.detail).toMatch(/sending requests/);
    expect(s?.primary.url).toBe("/app/quote-requests?setup=1");
  });

  it("hides the card when the feature isn't part of the app", () => {
    expect(storefrontStatus({ featureOn: false, buttonOn: false, lastRequestAt: null, themeEditorUrl: null })).toBeNull();
  });
});
