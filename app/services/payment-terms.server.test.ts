import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clearPaymentTermsCache,
  getPaymentTerms,
  mapPaymentTermsTemplates,
  type PaymentTerm,
} from "./payment-terms.server";

describe("mapPaymentTermsTemplates (pure)", () => {
  it("maps templates and defaults missing fields", () => {
    const terms = mapPaymentTermsTemplates({
      paymentTermsTemplates: [
        { id: "gid://t/1", name: "Net 30", paymentTermsType: "NET", dueInDays: 30 },
        { id: "gid://t/2", name: "Due on fulfillment" },
      ],
    });
    expect(terms).toEqual([
      { id: "gid://t/1", name: "Net 30", paymentTermsType: "NET", dueInDays: 30 },
      { id: "gid://t/2", name: "Due on fulfillment", paymentTermsType: "NET", dueInDays: null },
    ]);
  });

  it("tolerates an empty response", () => {
    expect(mapPaymentTermsTemplates({})).toEqual([]);
  });
});

describe("getPaymentTerms cache", () => {
  beforeEach(() => clearPaymentTermsCache());
  const sample: PaymentTerm[] = [
    { id: "gid://t/1", name: "Net 30", paymentTermsType: "NET", dueInDays: 30 },
  ];

  it("caches within the TTL and refetches after expiry", async () => {
    const loader = vi.fn().mockResolvedValue(sample);
    const t0 = 5_000_000;
    await getPaymentTerms("s.myshopify.com", { loader, now: t0, ttlMs: 1000 });
    await getPaymentTerms("s.myshopify.com", { loader, now: t0 + 500, ttlMs: 1000 });
    expect(loader).toHaveBeenCalledTimes(1);
    await getPaymentTerms("s.myshopify.com", { loader, now: t0 + 2000, ttlMs: 1000 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
