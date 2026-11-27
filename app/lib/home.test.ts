import { describe, it, expect } from "vitest";
import { attentionItems, setupSteps, setupProgress, type AttentionCounts, type SetupState } from "./home";

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
