import { describe, it, expect } from "vitest";
import {
  validateTaxId,
  resolveTaxTreatment,
  formatInvoiceNumber,
  legacyInvoiceNumber,
  certificateExpiringSoon,
} from "./tax";
import { taxRegionsAllowed, taxCertWorkflowAllowed, compliantInvoiceNumbering } from "./billing";

describe("plan gating", () => {
  it("regions / cert workflow / compliant numbering are Growth-only", () => {
    for (const fn of [taxRegionsAllowed, taxCertWorkflowAllowed, compliantInvoiceNumbering]) {
      expect(fn("GROWTH")).toBe(true);
      expect(fn("STARTER")).toBe(false);
      expect(fn(null)).toBe(false);
    }
  });
});

describe("validateTaxId", () => {
  it("accepts EU VIES-style and KSA 15-digit VAT", () => {
    expect(validateTaxId("VAT", "DE123456789").valid).toBe(true);
    expect(validateTaxId("VAT", "300000000000003").valid).toBe(true); // KSA
    expect(validateTaxId("VAT", "300000000000001").valid).toBe(false); // KSA must end with 3
    expect(validateTaxId("VAT", "12").valid).toBe(false);
  });
  it("normalizes spaces/dashes and upcases", () => {
    expect(validateTaxId("VAT", "de 123-456-789").normalized).toBe("DE123456789");
  });
  it("validates an ABN by checksum", () => {
    expect(validateTaxId("ABN", "51824753556").valid).toBe(true); // known-valid ABN
    expect(validateTaxId("ABN", "51824753557").valid).toBe(false);
  });
  it("validates EIN length and GSTIN format", () => {
    expect(validateTaxId("EIN", "12-3456789").valid).toBe(true);
    expect(validateTaxId("EIN", "1234").valid).toBe(false);
    expect(validateTaxId("GST", "22AAAAA0000A1Z5").valid).toBe(true);
    expect(validateTaxId("GST", "notagstin").valid).toBe(false);
  });
});

describe("resolveTaxTreatment (default-taxed until verified)", () => {
  it("never exempts an unverified or rejected profile", () => {
    expect(resolveTaxTreatment({ status: "UNVERIFIED", exempt: true }, null).taxExempt).toBe(false);
    expect(resolveTaxTreatment({ status: "REJECTED", exempt: true }, null).taxExempt).toBe(false);
    expect(resolveTaxTreatment(null, null).taxExempt).toBe(false);
  });
  it("exempts only when VERIFIED + exempt", () => {
    expect(resolveTaxTreatment({ status: "VERIFIED", exempt: true }, null).taxExempt).toBe(true);
    expect(resolveTaxTreatment({ status: "VERIFIED", exempt: false }, null).taxExempt).toBe(false);
  });
  it("a region exempt-by-default policy exempts regardless of profile", () => {
    const t = resolveTaxTreatment({ status: "UNVERIFIED", exempt: false }, { exemptByDefault: true });
    expect(t.taxExempt).toBe(true);
    expect(t.reason).toBe("region-exempt");
  });
});

describe("invoice numbering", () => {
  it("formats a compliant sequential number", () => {
    expect(formatInvoiceNumber(42)).toBe("INV-000042");
    expect(formatInvoiceNumber(1, "SA")).toBe("SA-000001");
  });
  it("falls back to an id-based label", () => {
    expect(legacyInvoiceNumber("clabcdef1234 zz".replace(" ", ""))).toHaveLength(8);
  });
});

describe("certificateExpiringSoon", () => {
  const now = new Date("2026-07-28");
  it("flags certs within the window (and already-expired)", () => {
    expect(certificateExpiringSoon(new Date("2026-08-10"), now, 30)).toBe(true);
    expect(certificateExpiringSoon(new Date("2026-07-01"), now, 30)).toBe(true); // expired
    expect(certificateExpiringSoon(new Date("2026-10-01"), now, 30)).toBe(false);
    expect(certificateExpiringSoon(null, now, 30)).toBe(false);
  });
});
