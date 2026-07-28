import { describe, it, expect } from "vitest";
import {
  backoffDelayMs,
  shouldRetry,
  nextStatusAfterAttempt,
  dedupeKey,
  mapTaxCode,
  incomeAccount,
  customerRef,
  normalizeInvoice,
  connectionHealth,
  summarizeForDigest,
  providerName,
  SYNC_MAX_ATTEMPTS,
  type RawInvoice,
} from "./accounting";
import { accountingSyncAllowed } from "./billing";

describe("plan gating", () => {
  it("accounting sync is Growth-only", () => {
    expect(accountingSyncAllowed("GROWTH")).toBe(true);
    expect(accountingSyncAllowed("Growth")).toBe(true);
    expect(accountingSyncAllowed("STARTER")).toBe(false);
    expect(accountingSyncAllowed(null)).toBe(false);
  });
});

describe("retry / backoff", () => {
  it("grows exponentially and caps", () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(3)).toBe(120_000);
    expect(backoffDelayMs(99)).toBe(3_600_000); // capped
  });

  it("stops retrying at the max attempts", () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(SYNC_MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(SYNC_MAX_ATTEMPTS)).toBe(false);
  });

  it("maps an attempt outcome to the next status (the whole retry policy)", () => {
    expect(nextStatusAfterAttempt(true, 1)).toBe("SYNCED");
    // failure with attempts left → PENDING (cron retries)
    expect(nextStatusAfterAttempt(false, 1)).toBe("PENDING");
    // failure at the ceiling → parked FAILED
    expect(nextStatusAfterAttempt(false, SYNC_MAX_ATTEMPTS)).toBe("FAILED");
  });
});

describe("idempotency", () => {
  it("dedupe key matches the DB unique tuple", () => {
    expect(dedupeKey("QBO", "INVOICE", "inv_123")).toBe("QBO:INVOICE:inv_123");
    expect(dedupeKey("XERO", "INVOICE", "inv_123")).not.toBe(dedupeKey("QBO", "INVOICE", "inv_123"));
  });
});

describe("field mapping", () => {
  it("maps a tax class, falling back to default", () => {
    expect(mapTaxCode("standard", { standard: "TAX", default: "NON" })).toBe("TAX");
    expect(mapTaxCode("unknown", { default: "NON" })).toBe("NON");
    expect(mapTaxCode(null, {})).toBeNull();
  });

  it("reads the default income account", () => {
    expect(incomeAccount({ income: "200" })).toBe("200");
    expect(incomeAccount({})).toBeNull();
  });
});

describe("customer matching", () => {
  it("prefers the chosen strategy, then falls back to whatever exists", () => {
    expect(customerRef("EMAIL", { email: "a@b.com", name: "Acme" })).toEqual({ by: "EMAIL", value: "a@b.com" });
    expect(customerRef("NAME", { email: "a@b.com", name: "Acme" })).toEqual({ by: "NAME", value: "Acme" });
    // strategy field missing → fall back to the other
    expect(customerRef("EMAIL", { name: "Acme" })).toEqual({ by: "NAME", value: "Acme" });
    expect(customerRef("NAME", { email: "a@b.com" })).toEqual({ by: "EMAIL", value: "a@b.com" });
    expect(customerRef("EMAIL", {})).toBeNull();
  });
});

describe("normalizeInvoice", () => {
  const raw: RawInvoice = {
    id: "inv_abcdef1234",
    amount: "293.80",
    currency: "USD",
    issuedAt: new Date("2026-07-01T00:00:00Z"),
    dueDate: new Date("2026-07-31T00:00:00Z"),
    paidAt: null,
    status: "OPEN",
    companyName: "Cedar & Co.",
    buyer: { email: "buyer@cedar.co", name: "Sam" },
  };

  it("reshapes without recomputing money and maps codes", () => {
    const n = normalizeInvoice(raw, { taxCodeMap: { default: "TAX" }, accountMap: { income: "200" }, customerMatchStrategy: "EMAIL" });
    expect(n).not.toBeNull();
    expect(n!.total).toBe("293.80"); // snapshot, never recomputed
    expect(n!.lines[0].taxCode).toBe("TAX");
    expect(n!.lines[0].accountId).toBe("200");
    expect(n!.customer).toEqual({ by: "EMAIL", value: "buyer@cedar.co", companyName: "Cedar & Co." });
    expect(n!.payment).toBeNull();
  });

  it("attaches a payment when the invoice is already paid", () => {
    const n = normalizeInvoice(
      { ...raw, status: "PAID", paidAt: new Date("2026-07-20T00:00:00Z") },
      { taxCodeMap: {}, accountMap: {}, customerMatchStrategy: "EMAIL" },
    );
    expect(n!.payment).toEqual({ amount: "293.80", paidAt: "2026-07-20T00:00:00.000Z" });
  });

  it("returns null when there's no customer to match", () => {
    const n = normalizeInvoice({ ...raw, buyer: {} }, { taxCodeMap: {}, accountMap: {}, customerMatchStrategy: "EMAIL" });
    expect(n).toBeNull();
  });
});

describe("connection health", () => {
  const now = new Date("2026-07-27T12:00:00Z");
  it("reports EXPIRED once the token expiry passes", () => {
    expect(connectionHealth("CONNECTED", new Date("2026-07-27T11:00:00Z"), now)).toBe("EXPIRED");
    expect(connectionHealth("CONNECTED", new Date("2026-07-27T13:00:00Z"), now)).toBe("CONNECTED");
    expect(connectionHealth("ERROR", null, now)).toBe("ERROR");
    expect(connectionHealth("CONNECTED", null, now)).toBe("CONNECTED");
  });
});

describe("digest summary", () => {
  it("counts by status and flags attention on any failure", () => {
    const s = summarizeForDigest([{ status: "FAILED" }, { status: "SYNCED" }, { status: "PENDING" }, { status: "FAILED" }]);
    expect(s).toEqual({ failed: 2, pending: 1, synced: 1, needsAttention: true });
    expect(summarizeForDigest([{ status: "SYNCED" }]).needsAttention).toBe(false);
  });
});

describe("provider names", () => {
  it("resolves display names", () => {
    expect(providerName("QBO")).toBe("QuickBooks Online");
    expect(providerName("XERO")).toBe("Xero");
  });
});
