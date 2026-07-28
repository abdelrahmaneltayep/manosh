import { describe, it, expect } from "vitest";
import { DEFAULT_TEMPLATES, resolveTemplate, renderTemplate, type TemplateKey } from "./mailer.server";
import { SUPPORTED_LOCALES } from "../lib/i18n";

const KEYS = Object.keys(DEFAULT_TEMPLATES) as TemplateKey[];

describe("mailer localization (F16) — every email resolves in every locale", () => {
  it("returns a non-empty subject + body for every key × locale (EN fallback)", () => {
    for (const locale of SUPPORTED_LOCALES.map((l) => l.code)) {
      for (const key of KEYS) {
        const t = resolveTemplate(key, null, locale);
        expect(t.subject, `${key} @ ${locale} subject`).toBeTruthy();
        expect(t.body, `${key} @ ${locale} body`).toBeTruthy();
      }
    }
  });

  it("uses the Arabic translation when present, else falls back to EN", () => {
    const ar = resolveTemplate("invoice_issued", null, "ar");
    expect(ar.subject).toMatch(/فاتورة/); // translated
    const arFallback = resolveTemplate("erp_sync_failure", null, "ar");
    expect(arFallback.subject).toBe(DEFAULT_TEMPLATES.erp_sync_failure.subject); // no AR → EN
  });

  it("a shop override still wins over a locale translation", () => {
    const t = resolveTemplate("invoice_issued", { invoice_issued: { subject: "Custom", body: "Body" } }, "ar");
    expect(t.subject).toBe("Custom");
  });

  it("renders placeholders in the localized body", () => {
    const ar = resolveTemplate("paylink", null, "ar");
    const { body } = renderTemplate(ar, { amount: "SAR 100", payUrl: "https://x", buyerName: "سامي", shopName: "متجر" });
    expect(body).toContain("SAR 100");
    expect(body).not.toContain("{{");
  });
});
