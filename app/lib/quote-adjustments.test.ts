import { describe, expect, it } from "vitest";
import { adjustmentDraftFields, parseAdjustments, readAdjustments, sendBlockedReason, sendLabel } from "./quote-adjustments";
import { buildTimeline } from "./quote-timeline";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

describe("parseAdjustments", () => {
  it("reads a percentage discount, a shipping line and custom items", () => {
    const r = parseAdjustments(
      form({
        discountType: "PERCENTAGE", discountValue: "10", discountTitle: "Volume",
        shippingTitle: "Freight", shippingPrice: "0",
        customTitle_0: "Setup fee", customQuantity_0: "1", customPrice_0: "150",
        customTitle_1: "", customQuantity_1: "1", customPrice_1: "",
      }),
    );
    expect(r).toEqual({
      ok: true,
      adjustments: {
        discount: { valueType: "PERCENTAGE", value: "10", title: "Volume" },
        shipping: { title: "Freight", price: "0" },
        customItems: [{ title: "Setup fee", quantity: 1, price: "150" }],
      },
    });
  });

  it.each([
    [{ discountType: "PERCENTAGE", discountValue: "120" }, /between 0 and 100/],
    [{ discountType: "PERCENTAGE", discountValue: "0" }, /between 0 and 100/],
    [{ discountType: "FIXED_AMOUNT", discountValue: "-5" }, /above 0/],
    [{ shippingTitle: "Freight", shippingPrice: "" }, /shipping price/],
    [{ customTitle_0: "Fee", customPrice_0: "0" }, /price above 0 for “Fee”/],
    [{ customTitle_0: "Fee", customPrice_0: "-3" }, /price above 0/],
    [{ customTitle_0: "", customPrice_0: "5" }, /name/],
    [{ customTitle_0: "Fee", customQuantity_0: "0", customPrice_0: "5" }, /whole quantity/],
  ])("refuses %o", (entries, message) => {
    const r = parseAdjustments(form(entries as Record<string, string>));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(message);
  });

  it("maps to Shopify's draft-order fields without computing anything", () => {
    const fields = adjustmentDraftFields(
      { discount: { valueType: "FIXED_AMOUNT", value: "25.50", title: null }, shipping: { title: "Freight", price: "40" }, customItems: [{ title: "Fee", quantity: 2, price: "15" }] },
      "CAD",
    );
    expect(fields).toEqual({
      appliedDiscount: { valueType: "FIXED_AMOUNT", value: 25.5 },
      shippingLine: { title: "Freight", priceWithCurrency: { amount: "40", currencyCode: "CAD" } },
      customLineItems: [{ title: "Fee", quantity: 2, originalUnitPriceWithCurrency: { amount: "15", currencyCode: "CAD" } }],
    });
  });

  it("reads stored adjustments defensively", () => {
    expect(readAdjustments(null)).toEqual({ discount: null, shipping: null, customItems: [] });
    expect(readAdjustments({ discount: { valueType: "BOGUS", value: "1" }, customItems: [{ title: 1 }] })).toEqual({ discount: null, shipping: null, customItems: [] });
  });
});

describe("sending", () => {
  const future = new Date(Date.now() + 86_400_000);
  it("says Send quote, and Send counter only after a buyer offer", () => {
    expect(sendLabel({ buyerOffered: false })).toBe("Send quote");
    expect(sendLabel({ buyerOffered: true })).toBe("Send counter");
  });
  it("is off once the quote expires or was sent", () => {
    expect(sendBlockedReason({ status: "SUBMITTED", expiresAt: future })).toBeNull();
    expect(sendBlockedReason({ status: "SUBMITTED", expiresAt: new Date(Date.now() - 1000) })).toMatch(/expired/);
    expect(sendBlockedReason({ status: "EXPIRED", expiresAt: future })).toMatch(/expired/);
    expect(sendBlockedReason({ status: "COUNTERED", expiresAt: future })).toMatch(/already sent/);
  });
});

describe("timeline", () => {
  it("lists events and emails newest first, failures marked", () => {
    const rows = buildTimeline(
      [
        { type: "QUOTE_SUBMITTED", createdAt: "2026-11-01T10:00:00Z", payload: { requestId: "r1" } },
        { type: "QUOTE_COUNTERED", createdAt: "2026-11-02T10:00:00Z" },
        { type: "SOMETHING_INTERNAL", createdAt: "2026-11-02T11:00:00Z" },
      ],
      [
        { to: "b@x.co", template: "quote_sent", status: "FAILED", error: "Inactive recipient.", createdAt: "2026-11-02T10:00:05Z" },
        { to: "b@x.co", template: "quote_sent", status: "SKIPPED", error: null, createdAt: "2026-11-02T10:00:06Z" },
      ],
    );
    expect(rows.map((r) => r.text)).toEqual([
      "Quote email to b@x.co wasn’t delivered: Inactive recipient",
      "Quote sent to the buyer",
      "Quote requested from your store",
    ]);
    expect(rows[0].tone).toBe("critical");
  });
});
