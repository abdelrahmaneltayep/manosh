import { describe, it, expect } from "vitest";
import {
  DraftOrderError,
  buildDraftOrderInput,
  calculateDraftOrder,
  createDraftOrder,
  mapCalculatedTotals,
  mapCreatedDraftOrder,
  type AdminGraphqlClient,
} from "./draft-order.server";

describe("buildDraftOrderInput (pure)", () => {
  it("builds purchasingEntity (company + location + contact) and priceOverride lines", () => {
    const input = buildDraftOrderInput({
      currencyCode: "USD",
      poReference: "PO-42",
      purchasingEntity: {
        companyId: "gid://shopify/Company/1",
        companyLocationId: "gid://shopify/CompanyLocation/2",
        companyContactId: "gid://shopify/CompanyContact/3",
      },
      lines: [{ variantId: "gid://v/1", quantity: 4, price: "8.75" }],
    });

    expect(input.purchasingEntity.purchasingCompany).toEqual({
      companyId: "gid://shopify/Company/1",
      companyLocationId: "gid://shopify/CompanyLocation/2",
      companyContactId: "gid://shopify/CompanyContact/3",
    });
    expect(input.lineItems).toEqual([
      {
        variantId: "gid://v/1",
        quantity: 4,
        priceOverride: { amount: "8.75", currencyCode: "USD" },
      },
    ]);
    expect(input.poNumber).toBe("PO-42");
  });

  it("omits contact, PO, and payment terms when absent", () => {
    const input = buildDraftOrderInput({
      currencyCode: "USD",
      purchasingEntity: {
        companyId: "c",
        companyLocationId: "l",
        companyContactId: null,
      },
      lines: [{ variantId: "v", quantity: 1, price: "1.00" }],
    });
    expect(input.purchasingEntity.purchasingCompany.companyContactId).toBeUndefined();
    expect(input.poNumber).toBeUndefined();
    expect(input.paymentTerms).toBeUndefined();
  });

  it("attaches a native payment terms template when provided", () => {
    const input = buildDraftOrderInput({
      currencyCode: "USD",
      paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/7",
      purchasingEntity: { companyId: "c", companyLocationId: "l", companyContactId: null },
      lines: [{ variantId: "v", quantity: 1, price: "1.00" }],
    });
    expect(input.paymentTerms).toEqual({
      paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/7",
    });
  });
});

const totalsPayload = (id?: string) => ({
  ...(id ? { id } : {}),
  subtotalPriceSet: { shopMoney: { amount: "190.00", currencyCode: "USD" } },
  totalTaxSet: { shopMoney: { amount: "15.20", currencyCode: "USD" } },
  totalPriceSet: { shopMoney: { amount: "205.20", currencyCode: "USD" } },
});

describe("mapCalculatedTotals / mapCreatedDraftOrder (pure)", () => {
  it("maps calculated totals", () => {
    expect(
      mapCalculatedTotals({ calculatedDraftOrder: totalsPayload(), userErrors: [] }),
    ).toEqual({ subtotal: "190.00", totalTax: "15.20", total: "205.20", currencyCode: "USD" });
  });

  it("maps a created draft order id + totals", () => {
    const result = mapCreatedDraftOrder({
      draftOrder: totalsPayload("gid://shopify/DraftOrder/9"),
      userErrors: [],
    });
    expect(result.id).toBe("gid://shopify/DraftOrder/9");
    expect(result.totals.total).toBe("205.20");
  });

  it("throws on userErrors", () => {
    expect(() =>
      mapCalculatedTotals({ userErrors: [{ message: "bad input" }] }),
    ).toThrow(DraftOrderError);
    expect(() =>
      mapCreatedDraftOrder({ userErrors: [{ message: "nope" }] }),
    ).toThrow(DraftOrderError);
  });

  it("throws when no order is returned", () => {
    expect(() => mapCalculatedTotals({})).toThrow(DraftOrderError);
    expect(() => mapCreatedDraftOrder({})).toThrow(DraftOrderError);
  });
});

function mockAdmin(byMutation: Record<string, unknown>): AdminGraphqlClient & {
  calls: Array<{ query: string; variables: unknown }>;
} {
  const calls: Array<{ query: string; variables: unknown }> = [];
  return {
    calls,
    graphql: async (query, options) => {
      calls.push({ query, variables: options?.variables });
      const key = query.includes("draftOrderCalculate")
        ? "draftOrderCalculate"
        : "draftOrderCreate";
      return { json: async () => ({ data: { [key]: byMutation[key] } }) };
    },
  };
}

describe("calculateDraftOrder / createDraftOrder (mocked admin)", () => {
  const input = buildDraftOrderInput({
    currencyCode: "USD",
    purchasingEntity: { companyId: "c", companyLocationId: "l", companyContactId: null },
    lines: [{ variantId: "v", quantity: 1, price: "1.00" }],
  });

  it("calculates via the admin client", async () => {
    const admin = mockAdmin({
      draftOrderCalculate: { calculatedDraftOrder: totalsPayload(), userErrors: [] },
    });
    const totals = await calculateDraftOrder(admin, input);
    expect(totals.total).toBe("205.20");
    expect(admin.calls[0].variables).toEqual({ input });
  });

  it("creates via the admin client", async () => {
    const admin = mockAdmin({
      draftOrderCreate: {
        draftOrder: totalsPayload("gid://shopify/DraftOrder/1"),
        userErrors: [],
      },
    });
    const created = await createDraftOrder(admin, input);
    expect(created.id).toBe("gid://shopify/DraftOrder/1");
  });

  it("surfaces Shopify userErrors as a DraftOrderError", async () => {
    const admin = mockAdmin({
      draftOrderCreate: { draftOrder: null, userErrors: [{ message: "Company location required" }] },
    });
    await expect(createDraftOrder(admin, input)).rejects.toBeInstanceOf(DraftOrderError);
  });
});
