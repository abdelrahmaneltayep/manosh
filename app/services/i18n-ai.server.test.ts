import { describe, it, expect } from "vitest";
import { sanitizeTranslations, TRANSLATABLE_KEYS } from "./i18n-ai.server";
import { portalTranslationsFeature } from "./prompts/portal-translations";

describe("sanitizeTranslations", () => {
  it("keeps only known keys with non-empty string values", () => {
    const raw = {
      quotes: "عروض الأسعار",
      total: "الإجمالي",
      not_a_real_key: "junk", // dropped — unknown
      submit: "", // dropped — empty
      sign_out: 42, // dropped — non-string
    };
    const out = sanitizeTranslations(raw);
    expect(out).toEqual({ quotes: "عروض الأسعار", total: "الإجمالي" });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeTranslations(null)).toEqual({});
    expect(sanitizeTranslations("nope")).toEqual({});
  });

  it("every catalog key is allowed", () => {
    const raw = Object.fromEntries(TRANSLATABLE_KEYS.map((k) => [k, "x"]));
    const out = sanitizeTranslations(raw);
    expect(Object.keys(out).length).toBe(TRANSLATABLE_KEYS.length);
  });
});

describe("portal_translations prompt", () => {
  it("lists the source keys and target language", () => {
    const user = portalTranslationsFeature.buildUser({
      localeCode: "ar",
      localeName: "العربية",
      sourceStrings: { quotes: "Quotes", total: "Total" },
    });
    expect(user).toContain("Target language: العربية (ar)");
    expect(user).toContain("- quotes: Quotes");
    expect(user).toContain("- total: Total");
  });
});
