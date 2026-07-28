import { describe, it, expect } from "vitest";
import {
  rateKey,
  resolveRate,
  convertAmount,
  resolveDisplayPrice,
  assertSingleCurrency,
  lockFx,
  type RateMap,
} from "./currency";

const rates: RateMap = new Map([[rateKey("USD", "SAR"), "3.75"]]);

describe("resolveRate", () => {
  it("returns 1 for the same currency, the stored rate, or null", () => {
    expect(resolveRate("USD", "USD", rates)).toBe("1");
    expect(resolveRate("USD", "SAR", rates)).toBe("3.75");
    expect(resolveRate("USD", "EUR", rates)).toBeNull();
  });
});

describe("convertAmount (no floats)", () => {
  it("converts cents-safely", () => {
    expect(convertAmount("100.00", "3.75")).toBe("375.00");
    expect(convertAmount("19.99", "3.75")).toBe("74.96");
    expect(convertAmount("bad", "3.75")).toBe("0.00");
  });
});

describe("resolveDisplayPrice (override > convert > base)", () => {
  it("uses a per-currency contract override when present", () => {
    expect(resolveDisplayPrice("100.00", "USD", "SAR", { override: "390.00", rate: "3.75" })).toEqual({ amount: "390.00", currency: "SAR", source: "override" });
  });
  it("converts at the rate when no override", () => {
    expect(resolveDisplayPrice("100.00", "USD", "SAR", { rate: "3.75" })).toEqual({ amount: "375.00", currency: "SAR", source: "converted" });
  });
  it("shows the base price when currencies match", () => {
    expect(resolveDisplayPrice("100.00", "USD", "USD", {})).toEqual({ amount: "100.00", currency: "USD", source: "base" });
  });
  it("falls back to base cleanly when there's no rate (guardrail)", () => {
    expect(resolveDisplayPrice("100.00", "USD", "SAR", {})).toEqual({ amount: "100.00", currency: "USD", source: "base" });
  });
});

describe("assertSingleCurrency (never mix)", () => {
  it("returns the single currency", () => {
    expect(assertSingleCurrency(["SAR", "SAR"])).toBe("SAR");
    expect(assertSingleCurrency([])).toBe("");
  });
  it("throws on a mix", () => {
    expect(() => assertSingleCurrency(["SAR", "USD"])).toThrow(/can't mix currencies/);
  });
});

describe("lockFx (rate locked at issue)", () => {
  it("locks the display currency + rate", () => {
    expect(lockFx("USD", "SAR", rates)).toEqual({ currency: "SAR", rate: "3.75" });
  });
  it("locks rate 1 for the same currency", () => {
    expect(lockFx("USD", "USD", rates)).toEqual({ currency: "USD", rate: "1" });
  });
  it("stays in base with rate 1 when no rate exists", () => {
    expect(lockFx("USD", "EUR", rates)).toEqual({ currency: "USD", rate: "1" });
  });
});
