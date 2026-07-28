import { describe, it, expect } from "vitest";
import {
  computeFloorPrice,
  marginForPrice,
  finalizeSuggestion,
  buildSuggestionSystemPrompt,
  buildSuggestionUserPrompt,
  normalizeSuggestion,
  suggestCounterOffer,
  round4,
  type SuggestionContext,
} from "./quote-assistant.server";

const baseContext: SuggestionContext = {
  productTitle: "Merino Beanie — Charcoal",
  sku: "BEANIE-CHAR",
  requestedQty: 120,
  listPrice: 14,
  costPrice: 7,
  currencyCode: "USD",
  minMarginPct: 0.15,
  quoteHistory: [],
};

describe("computeFloorPrice", () => {
  it("derives the floor from cost and margin: cost / (1 - m)", () => {
    // cost 7, margin 15% → 7 / 0.85 = 8.2353
    expect(computeFloorPrice(7, 0.15)).toBeCloseTo(8.2353, 4);
  });

  it("returns null when cost is unknown", () => {
    expect(computeFloorPrice(null, 0.15)).toBeNull();
  });

  it("returns null for a nonsensical margin ≥ 100%", () => {
    expect(computeFloorPrice(7, 1)).toBeNull();
    expect(computeFloorPrice(7, 1.5)).toBeNull();
  });

  it("floor equals cost at 0% margin", () => {
    expect(computeFloorPrice(7, 0)).toBe(7);
  });
});

describe("marginForPrice", () => {
  it("computes (price - cost) / price", () => {
    expect(marginForPrice(10, 7)).toBeCloseTo(0.3, 5);
  });
  it("is null when cost unknown or price non-positive", () => {
    expect(marginForPrice(10, null)).toBeNull();
    expect(marginForPrice(0, 7)).toBeNull();
  });
});

describe("finalizeSuggestion — the floor guardrail", () => {
  it("flags belowFloor when the model dips under the floor", () => {
    const out = finalizeSuggestion(
      { suggestedPrice: 8, rationale: "r", draftMessage: "m" },
      { costPrice: 7, minMarginPct: 0.15 }, // floor 8.2353
    );
    expect(out.belowFloor).toBe(true);
    expect(out.floorPrice).toBeCloseTo(8.2353, 4);
  });

  it("does NOT flag when the price clears the floor", () => {
    const out = finalizeSuggestion(
      { suggestedPrice: 9, rationale: "r", draftMessage: "m" },
      { costPrice: 7, minMarginPct: 0.15 },
    );
    expect(out.belowFloor).toBe(false);
    expect(out.marginPct).toBeCloseTo((9 - 7) / 9, 5);
  });

  it("never flags belowFloor when cost is unknown (no floor to breach)", () => {
    const out = finalizeSuggestion(
      { suggestedPrice: 1, rationale: "r", draftMessage: "m" },
      { costPrice: null, minMarginPct: 0.15 },
    );
    expect(out.belowFloor).toBe(false);
    expect(out.floorPrice).toBeNull();
    expect(out.marginPct).toBeNull();
  });

  it("clamps a negative model price to 0 and rounds to 4dp", () => {
    const out = finalizeSuggestion(
      { suggestedPrice: -5, rationale: "r", draftMessage: "m" },
      { costPrice: null, minMarginPct: 0.15 },
    );
    expect(out.suggestedPrice).toBe(0);
  });
});

describe("round4", () => {
  it("rounds to four decimals", () => {
    expect(round4(8.23529)).toBe(8.2353);
  });
});

describe("prompts", () => {
  it("states the floor margin percent in the system prompt", () => {
    expect(buildSuggestionSystemPrompt(0.15)).toContain("15%");
  });
  it("includes the floor price and quantity in the user prompt", () => {
    const p = buildSuggestionUserPrompt(baseContext);
    expect(p).toContain("Requested quantity: 120");
    expect(p).toContain("Floor price");
  });
  it("notes unknown cost when none is provided", () => {
    const p = buildSuggestionUserPrompt({ ...baseContext, costPrice: null });
    expect(p).toContain("unknown");
  });
});

describe("normalizeSuggestion", () => {
  it("coerces tool input and defaults missing fields", () => {
    expect(normalizeSuggestion({ suggested_unit_price: "9.5", rationale: "r" })).toEqual({
      suggestedPrice: 9.5,
      rationale: "r",
      draftMessage: "",
    });
  });
  it("defaults a non-numeric price to 0", () => {
    expect(normalizeSuggestion({ suggested_unit_price: "abc" }).suggestedPrice).toBe(0);
  });
});

describe("suggestCounterOffer (injected model)", () => {
  it("runs the model output through the floor math", async () => {
    const result = await suggestCounterOffer(baseContext, {
      invoke: async () => ({
        suggestedPrice: 11.5,
        rationale: "Volume of 120 supports a modest discount while holding margin.",
        draftMessage: "Happy to offer $11.50/unit at this volume.",
      }),
    });
    expect(result.suggestedPrice).toBe(11.5);
    expect(result.belowFloor).toBe(false);
    expect(result.marginPct).toBeCloseTo((11.5 - 7) / 11.5, 5);
    expect(result.model).toBe("claude-haiku-4-5");
  });

  it("surfaces a floor breach from the model", async () => {
    const result = await suggestCounterOffer(baseContext, {
      invoke: async () => ({ suggestedPrice: 7.5, rationale: "r", draftMessage: "m" }),
    });
    expect(result.belowFloor).toBe(true); // 7.5 < floor 8.2353
  });
});
