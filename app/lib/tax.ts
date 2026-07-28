// F14 — pure tax logic: tax-ID format validation, the exemption-treatment
// decision (default-taxed until verified), invoice-number formatting, and cert
// expiry. No Prisma, no network — unit-tested. Mannon never COMPUTES tax
// (Shopify does); resolveTaxTreatment only decides the taxExempt FLAG we hand to
// the draft order, plus what to display.

export type TaxIdType = "VAT" | "GST" | "ABN" | "EIN" | "OTHER";
export type TaxStatus = "UNVERIFIED" | "VERIFIED" | "REJECTED";

export interface TaxIdValidation {
  valid: boolean;
  normalized: string;
  reason?: string;
}

/**
 * Format-validate a tax id. These are *format* checks (length / charset / a
 * couple of well-known check digits), not a live registry lookup — a real VIES /
 * ZATCA call is a documented follow-up. Pure.
 */
export function validateTaxId(type: TaxIdType, raw: string): TaxIdValidation {
  const normalized = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!normalized) return { valid: false, normalized, reason: "Empty tax id" };

  switch (type) {
    case "VAT": {
      // Two-letter country prefix + 2–13 alphanumerics (EU VIES-style). KSA VAT
      // is 15 digits (may arrive without the "SA" prefix), so accept that too.
      if (/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(normalized)) return { valid: true, normalized };
      if (/^\d{15}$/.test(normalized)) {
        // KSA VAT: starts and ends with 3, digit 11 is a checksum we don't verify here.
        return normalized.startsWith("3") && normalized.endsWith("3")
          ? { valid: true, normalized }
          : { valid: false, normalized, reason: "KSA VAT must start and end with 3" };
      }
      return { valid: false, normalized, reason: "Not a valid VAT format" };
    }
    case "GST": {
      // India GSTIN: 15 chars, 2-digit state + 10-char PAN + entity + Z + checksum.
      return /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d$/.test(normalized)
        ? { valid: true, normalized }
        : { valid: false, normalized, reason: "Not a valid GSTIN format" };
    }
    case "ABN": {
      // Australian Business Number: 11 digits with a weighted checksum.
      if (!/^\d{11}$/.test(normalized)) return { valid: false, normalized, reason: "ABN must be 11 digits" };
      return abnChecksum(normalized) ? { valid: true, normalized } : { valid: false, normalized, reason: "ABN checksum failed" };
    }
    case "EIN": {
      // US EIN: 9 digits (XX-XXXXXXX).
      return /^\d{9}$/.test(normalized) ? { valid: true, normalized } : { valid: false, normalized, reason: "EIN must be 9 digits" };
    }
    default:
      // OTHER: accept any non-trivial alphanumeric id.
      return normalized.length >= 4 ? { valid: true, normalized } : { valid: false, normalized, reason: "Too short" };
  }
}

/** ABN weighted-modulus-89 checksum. Pure. */
function abnChecksum(abn: string): boolean {
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const digits = abn.split("").map(Number);
  digits[0] -= 1; // subtract 1 from the first digit
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  return sum % 89 === 0;
}

export interface TaxProfileLite {
  status: TaxStatus;
  exempt: boolean;
}

export interface RegionRuleLite {
  exemptByDefault: boolean;
  rate?: string | null;
}

export interface TaxTreatment {
  taxExempt: boolean;
  reason: string;
  displayStatus: string; // shown on quotes/invoices
}

/**
 * Decide the tax treatment for an order. DEFAULT-TAXED: a buyer is only exempt
 * when their profile is VERIFIED **and** flagged exempt, or the merchant set the
 * region to exempt-by-default. An unverified/rejected profile is always taxed —
 * never auto-exempt on an unverified upload (the guardrail). Pure.
 */
export function resolveTaxTreatment(
  profile: TaxProfileLite | null,
  regionRule: RegionRuleLite | null,
): TaxTreatment {
  if (regionRule?.exemptByDefault) {
    return { taxExempt: true, reason: "region-exempt", displayStatus: "Exempt (region policy)" };
  }
  if (profile && profile.status === "VERIFIED" && profile.exempt) {
    return { taxExempt: true, reason: "verified-exempt", displayStatus: "Tax exempt (verified)" };
  }
  if (profile && profile.status === "VERIFIED") {
    return { taxExempt: false, reason: "verified-taxed", displayStatus: "Taxed (VAT verified)" };
  }
  if (profile && profile.status === "REJECTED") {
    return { taxExempt: false, reason: "rejected", displayStatus: "Taxed (documents rejected)" };
  }
  return { taxExempt: false, reason: "unverified", displayStatus: "Taxed (unverified)" };
}

/** Format a compliant invoice number, e.g. 42 → "INV-000042". Pure. */
export function formatInvoiceNumber(seq: number, prefix = "INV"): string {
  return `${prefix}-${String(seq).padStart(6, "0")}`;
}

/** Fallback invoice label when no compliant sequence exists (Starter). Pure. */
export function legacyInvoiceNumber(invoiceId: string): string {
  return invoiceId.slice(-8).toUpperCase();
}

/** Is a time-limited certificate within `days` of expiring (or already expired)? Pure. */
export function certificateExpiringSoon(expiresAt: Date | null, now: Date = new Date(), days = 30): boolean {
  if (!expiresAt) return false;
  const cutoff = now.getTime() + days * 24 * 60 * 60 * 1000;
  return expiresAt.getTime() <= cutoff;
}
