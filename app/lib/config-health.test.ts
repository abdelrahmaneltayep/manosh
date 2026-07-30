import { describe, it, expect } from "vitest";
import { summarizeConfigHealth, isPlaceholder, CORE_REQUIRED, FEATURE_FLAGS } from "./config-health";

const FULL = {
  SHOPIFY_API_KEY: "ad4c04f1bcb8aab2dc441ea8bf947a00",
  SHOPIFY_API_SECRET: "shpss_realsecret",
  SHOPIFY_APP_URL: "https://manosh.fly.dev",
  SCOPES: "read_products,read_orders",
  SESSION_SECRET: "x".repeat(40),
  DATABASE_URL: "postgres://u:p@h/db",
};

describe("isPlaceholder", () => {
  it("flags copy-paste placeholders, not real values", () => {
    expect(isPlaceholder("<from Shopify Partners → …>")).toBe(true);
    expect(isPlaceholder("from Partners")).toBe(true);
    expect(isPlaceholder("changeme")).toBe(true);
    expect(isPlaceholder("shpss_realsecret")).toBe(false);
    expect(isPlaceholder(undefined)).toBe(false);
  });
});

describe("summarizeConfigHealth", () => {
  it("ok when every required var is a real value", () => {
    const h = summarizeConfigHealth(FULL);
    expect(h.ok).toBe(true);
    expect(h.requiredMissing).toEqual([]);
    expect(h.requiredPlaceholder).toEqual([]);
    expect(h.apiKeyLooksValid).toBe(true);
  });

  it("reports the exact missing required vars (the reviewer-blocker)", () => {
    const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, ...rest } = FULL;
    const h = summarizeConfigHealth(rest);
    expect(h.ok).toBe(false);
    expect(h.requiredMissing).toContain("SHOPIFY_API_KEY");
    expect(h.requiredMissing).toContain("SHOPIFY_API_SECRET");
    expect(h.apiKeyLooksValid).toBe(false);
  });

  it("catches a pasted placeholder secret", () => {
    const h = summarizeConfigHealth({ ...FULL, SHOPIFY_API_SECRET: "<from Partners>" });
    expect(h.ok).toBe(false);
    expect(h.requiredPlaceholder).toEqual(["SHOPIFY_API_SECRET"]);
  });

  it("never leaks values — only booleans/derived signals", () => {
    const json = JSON.stringify(summarizeConfigHealth(FULL));
    expect(json).not.toContain("ad4c04f1bcb8aab2dc441ea8bf947a00");
    expect(json).not.toContain("shpss_realsecret");
    expect(json).not.toContain("manosh.fly.dev");
  });

  it("covers all 6 required vars and all 20 feature flags", () => {
    expect(CORE_REQUIRED).toHaveLength(6);
    expect(FEATURE_FLAGS).toHaveLength(20);
    const h = summarizeConfigHealth({ ...FULL, MANNON_FF_AI_QUOTE: "true" });
    expect(h.flags.find((f) => f.flag === "MANNON_FF_AI_QUOTE")?.on).toBe(true);
    expect(h.flags.find((f) => f.flag === "MANNON_FF_WHITE_LABEL")?.on).toBe(false);
  });
});
