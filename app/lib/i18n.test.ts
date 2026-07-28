import { describe, it, expect } from "vitest";
import { localeDir, isSupportedLocale, t, formatMoney, SUPPORTED_LOCALES } from "./i18n";
import { contractRatesAllowed, evaluateCurrencyAllowance, PLAN_LIMITS } from "./billing";

describe("plan gating", () => {
  it("contract rates are Growth-only; Starter gets 1 extra currency + 2 locales", () => {
    expect(contractRatesAllowed("GROWTH")).toBe(true);
    expect(contractRatesAllowed("STARTER")).toBe(false);
    expect(PLAN_LIMITS.starter.extraCurrencyCap).toBe(1);
    expect(PLAN_LIMITS.starter.localeCap).toBe(2);
    expect(Number.isFinite(PLAN_LIMITS.growth.extraCurrencyCap)).toBe(false);
  });
  it("evaluateCurrencyAllowance allows while used < cap", () => {
    expect(evaluateCurrencyAllowance(0, 1).allowed).toBe(true);
    expect(evaluateCurrencyAllowance(1, 1).allowed).toBe(false);
  });
});

describe("localeDir (RTL for Arabic)", () => {
  it("returns rtl for ar, ltr otherwise", () => {
    expect(localeDir("ar")).toBe("rtl");
    expect(localeDir("en")).toBe("ltr");
    expect(localeDir("fr")).toBe("ltr");
    expect(localeDir("zz")).toBe("ltr"); // unknown → ltr fallback
  });
  it("knows its supported locales", () => {
    expect(isSupportedLocale("ar")).toBe(true);
    expect(isSupportedLocale("zz")).toBe(false);
    expect(SUPPORTED_LOCALES.map((l) => l.code)).toEqual(["en", "ar", "fr"]);
  });
});

describe("t (translate with fallback + overrides)", () => {
  it("returns the locale string, filling vars", () => {
    expect(t("ar", "quotes")).toBe("عروض الأسعار");
    expect(t("en", "priced_in", { currency: "SAR" })).toBe("Priced in SAR");
  });
  it("falls back to EN for an unknown locale", () => {
    expect(t("zz", "submit")).toBe("Submit");
  });
  it("applies a merchant override over the dictionary", () => {
    expect(t("en", "submit", {}, { en: { submit: "Send it" } })).toBe("Send it");
  });
});

describe("formatMoney (Intl per locale)", () => {
  it("formats in the buyer's currency without throwing", () => {
    const sar = formatMoney("2516.00", "SAR", "ar");
    expect(sar).toBeTruthy(); // ICU digit shaping is environment-dependent; just ensure it renders
    expect(sar).toMatch(/SAR|ر\.س|ريال|[٠-٩0-9]/);
    const usd = formatMoney(1000, "USD", "en");
    expect(usd).toMatch(/\$|USD/);
  });
  it("falls back gracefully on a bad currency", () => {
    expect(formatMoney(10, "ZZZ", "en")).toContain("ZZZ");
  });
});
