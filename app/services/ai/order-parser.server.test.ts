import { describe, it, expect, vi } from "vitest";
import type { CatalogItem } from "../catalog.server";
import type { ParsedOrderResult } from "./order-parser.server";
import {
  buildCatalogSystemPrompt,
  parseOrderPad,
  validateParsedOrder,
} from "./order-parser.server";

const CATALOG: CatalogItem[] = [
  { variantId: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/gid://shopify/ProductVariant/1", productTitle: "Widget", variantTitle: null, displayTitle: "Widget", sku: "A-1", price: "9.50", currencyCode: "USD" },
  { variantId: "gid://shopify/ProductVariant/2", productId: "gid://shopify/Product/gid://shopify/ProductVariant/2", productTitle: "Gadget", variantTitle: "Blue", displayTitle: "Gadget — Blue", sku: "B-2", price: "20.00", currencyCode: "USD" },
];

describe("buildCatalogSystemPrompt (pure)", () => {
  it("embeds each variant's sku, title, id, and price", () => {
    const prompt = buildCatalogSystemPrompt(CATALOG);
    expect(prompt).toContain("A-1 | Widget | gid://shopify/ProductVariant/1 | USD 9.50");
    expect(prompt).toContain("never invent one");
  });
});

describe("validateParsedOrder — every variant_id is validated against the catalog", () => {
  it("keeps valid lines and drops a hallucinated variant_id into unmatched", () => {
    // The model proposed two lines: one real, one invented.
    const parsed: ParsedOrderResult = {
      lines: [
        { variant_id: "gid://shopify/ProductVariant/1", sku: "A-1", quantity: 5, raw_text: "5x A-1" },
        { variant_id: "gid://shopify/ProductVariant/HALLUCINATED", sku: "ZZZ", quantity: 3, raw_text: "3x ZZZ" },
      ],
      unmatched: [],
    };
    const result = validateParsedOrder(parsed, CATALOG);

    // Exactly one matched line survived; the invented id did NOT.
    expect(result.matched).toEqual([
      { variantId: "gid://shopify/ProductVariant/1", sku: "A-1", title: "Widget", quantity: 5, price: "9.50", rawText: "5x A-1" },
    ]);
    expect(result.unmatched).toEqual(["3x ZZZ"]);
  });

  it("guarantees no matched line has a variant_id outside the catalog", () => {
    const validIds = new Set(CATALOG.map((c) => c.variantId));
    const parsed: ParsedOrderResult = {
      lines: [
        { variant_id: "gid://shopify/ProductVariant/2", quantity: 1, raw_text: "1x B-2" },
        { variant_id: "gid://shopify/ProductVariant/fake", quantity: 1, raw_text: "1x fake" },
        { variant_id: "totally-made-up", quantity: 2, raw_text: "2x nope" },
      ],
      unmatched: ["a line the model gave up on"],
    };
    const { matched, unmatched } = validateParsedOrder(parsed, CATALOG);
    expect(matched.every((line) => validIds.has(line.variantId))).toBe(true);
    // The model's own unmatched is preserved, plus the two dropped hallucinations.
    expect(unmatched).toContain("a line the model gave up on");
    expect(unmatched).toHaveLength(3);
  });

  it("clamps quantities to integers ≥ 1", () => {
    const parsed: ParsedOrderResult = {
      lines: [
        { variant_id: "gid://shopify/ProductVariant/1", quantity: 0, raw_text: "A-1" },
        { variant_id: "gid://shopify/ProductVariant/2", quantity: 3.9, raw_text: "B-2" },
      ],
      unmatched: [],
    };
    const { matched } = validateParsedOrder(parsed, CATALOG);
    expect(matched[0].quantity).toBe(1);
    expect(matched[1].quantity).toBe(3);
  });

  it("computes accepted-as-is rate (matched / proposed)", () => {
    const parsed: ParsedOrderResult = {
      lines: [
        { variant_id: "gid://shopify/ProductVariant/1", quantity: 1, raw_text: "A-1" },
        { variant_id: "bad", quantity: 1, raw_text: "bad" },
      ],
      unmatched: [],
    };
    expect(validateParsedOrder(parsed, CATALOG).acceptedAsIsRate).toBe(0.5);
    expect(validateParsedOrder({ lines: [], unmatched: [] }, CATALOG).acceptedAsIsRate).toBe(0);
  });
});

// Eval fixtures from /docs/ai-spec.md. The model is faked; each fixture asserts
// that after validation the matched SKUs and unmatched lines are exactly right —
// proving hallucinations never survive regardless of what the model returns.
describe("parseOrderPad eval fixtures (faked model)", () => {
  const fixture = (parsed: ParsedOrderResult) => vi.fn().mockResolvedValue(parsed);

  it("clean PO with exact SKUs", async () => {
    const invoke = fixture({
      lines: [
        { variant_id: "gid://shopify/ProductVariant/1", sku: "A-1", quantity: 10, raw_text: "A-1 x10" },
        { variant_id: "gid://shopify/ProductVariant/2", sku: "B-2", quantity: 4, raw_text: "B-2 x4" },
      ],
      unmatched: [],
    });
    const result = await parseOrderPad("A-1 x10\nB-2 x4", CATALOG, { invoke });
    expect(result.matched.map((l) => l.sku)).toEqual(["A-1", "B-2"]);
    expect(result.unmatched).toEqual([]);
    expect(result.acceptedAsIsRate).toBe(1);
  });

  it("email prose with one unknown SKU", async () => {
    const invoke = fixture({
      lines: [
        { variant_id: "gid://shopify/ProductVariant/2", sku: "B-2", quantity: 12, raw_text: "12 of the blue ones" },
      ],
      unmatched: ["also need some part# QQ-9 if you have it"],
    });
    const result = await parseOrderPad("hey can I get 12 of the blue ones… and QQ-9?", CATALOG, { invoke });
    expect(result.matched.map((l) => l.sku)).toEqual(["B-2"]);
    expect(result.unmatched).toEqual(["also need some part# QQ-9 if you have it"]);
  });

  it("mixed valid + hallucinated: the invented id is dropped, not carted", async () => {
    const invoke = fixture({
      lines: [
        { variant_id: "gid://shopify/ProductVariant/1", sku: "A-1", quantity: 2, raw_text: "2 widgets" },
        { variant_id: "gid://shopify/ProductVariant/9999", sku: "A-1", quantity: 5, raw_text: "5 widgets deluxe" },
      ],
      unmatched: [],
    });
    const result = await parseOrderPad("2 widgets\n5 widgets deluxe", CATALOG, { invoke });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].variantId).toBe("gid://shopify/ProductVariant/1");
    expect(result.unmatched).toEqual(["5 widgets deluxe"]);
    expect(result.acceptedAsIsRate).toBe(0.5);
  });

  it("passes the cached catalog prompt to the model", async () => {
    const invoke = fixture({ lines: [], unmatched: [] });
    await parseOrderPad("anything", CATALOG, { invoke });
    const call = invoke.mock.calls[0][0];
    expect(call.systemPrompt).toContain("gid://shopify/ProductVariant/1");
    expect(call.blob).toBe("anything");
  });
});
