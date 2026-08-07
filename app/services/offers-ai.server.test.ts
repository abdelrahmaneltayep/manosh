import { describe, it, expect } from "vitest";
import { deriveOfferFloor, finalizeOfferCounter } from "./offers-ai.server";
import { offerCounterFeature } from "./prompts/offer-counter";

describe("deriveOfferFloor", () => {
  it("derives a floor above the offer when margin is thin", () => {
    // offered 100 at 10% margin → cost 90; floor at 20% = 90/0.8 = 112.5
    expect(deriveOfferFloor(100, 0.1, 0.2)).toBe(112.5);
  });
  it("returns null when margin (cost) is unknown", () => {
    expect(deriveOfferFloor(100, null, 0.2)).toBeNull();
  });
  it("returns null for a pathological floor margin >= 1", () => {
    expect(deriveOfferFloor(100, 0.1, 1)).toBeNull();
  });
});

describe("finalizeOfferCounter", () => {
  it("flags a counter below the floor", () => {
    const r = finalizeOfferCounter(
      { counter_total: 100, note: "How about this?" },
      { listPriceTotal: 200, floorTotal: 112.5 },
    );
    expect(r.counterTotal).toBe(100);
    expect(r.belowFloor).toBe(true);
    expect(r.aboveList).toBe(false);
    expect(r.note).toBe("How about this?");
  });
  it("flags a counter above list price", () => {
    const r = finalizeOfferCounter(
      { counter_total: 250, note: "" },
      { listPriceTotal: 200, floorTotal: 112.5 },
    );
    expect(r.aboveList).toBe(true);
  });
  it("accepts a valid counter within floor..list", () => {
    const r = finalizeOfferCounter(
      { counter_total: 150, note: "Meeting you in the middle." },
      { listPriceTotal: 200, floorTotal: 112.5 },
    );
    expect(r.belowFloor).toBe(false);
    expect(r.aboveList).toBe(false);
  });
  it("coerces garbage model output to a safe zero", () => {
    const r = finalizeOfferCounter({ counter_total: "abc", note: 42 }, { listPriceTotal: 200, floorTotal: null });
    expect(r.counterTotal).toBe(0);
    expect(r.note).toBe("");
  });
});

describe("offer_counter prompt", () => {
  it("states the floor and buyer offer in the user prompt", () => {
    const user = offerCounterFeature.buildUser({
      currencyCode: "USD",
      listPriceTotal: 200,
      offeredTotal: 150,
      marginAtOffer: 0.2,
      floorTotal: 120,
      minMarginPct: 0.15,
    });
    expect(user).toContain("Buyer offered: 150.00");
    expect(user).toContain("Floor total (never go below): 120.00");
    expect(user).toContain("List price total: 200.00");
  });
  it("warns when cost is unknown", () => {
    const user = offerCounterFeature.buildUser({
      currencyCode: "USD",
      listPriceTotal: 200,
      offeredTotal: 150,
      marginAtOffer: null,
      floorTotal: null,
      minMarginPct: 0.15,
    });
    expect(user).toContain("unknown");
  });
});
