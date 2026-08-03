import { describe, it, expect } from "vitest";
import {
  ruleMatches,
  pickPriceRule,
  evaluateVisibility,
  priceRuleScopeAllowed,
  SHOW_ALL,
  type PriceRuleLite,
  type StorefrontContext,
} from "./price-visibility";

const rule = (over: Partial<PriceRuleLite> = {}): PriceRuleLite => ({
  id: "r1",
  scope: "ALL",
  scopeRef: null,
  hidePrice: true,
  hideAtc: false,
  ctaLabel: "Request a Quote",
  active: true,
  priority: 0,
  ...over,
});

const ctx = (over: Partial<StorefrontContext> = {}): StorefrontContext => ({ loggedIn: true, ...over });

describe("ruleMatches by scope", () => {
  it("ALL always; LOGGED_OUT only for anonymous", () => {
    expect(ruleMatches(rule({ scope: "ALL" }), ctx())).toBe(true);
    expect(ruleMatches(rule({ scope: "LOGGED_OUT" }), ctx({ loggedIn: false }))).toBe(true);
    expect(ruleMatches(rule({ scope: "LOGGED_OUT" }), ctx({ loggedIn: true }))).toBe(false);
  });
  it("CUSTOMER_TAG is case-insensitive; PRODUCT + COLLECTION match their ref", () => {
    expect(ruleMatches(rule({ scope: "CUSTOMER_TAG", scopeRef: "VIP" }), ctx({ customerTags: ["vip"] }))).toBe(true);
    expect(ruleMatches(rule({ scope: "CUSTOMER_TAG", scopeRef: "VIP" }), ctx({ customerTags: ["retail"] }))).toBe(false);
    expect(ruleMatches(rule({ scope: "PRODUCT", scopeRef: "gid://p/1" }), ctx({ productId: "gid://p/1" }))).toBe(true);
    expect(ruleMatches(rule({ scope: "COLLECTION", scopeRef: "gid://c/9" }), ctx({ collectionIds: ["gid://c/9"] }))).toBe(true);
  });
  it("ignores inactive rules", () => {
    expect(ruleMatches(rule({ active: false }), ctx())).toBe(false);
  });
});

describe("pickPriceRule priority + specificity", () => {
  it("higher priority wins; ties break by specificity (PRODUCT > ALL)", () => {
    const all = rule({ id: "all", scope: "ALL", priority: 0 });
    const prod = rule({ id: "prod", scope: "PRODUCT", scopeRef: "gid://p/1", priority: 0 });
    expect(pickPriceRule([all, prod], ctx({ productId: "gid://p/1" }))?.id).toBe("prod");
    const hi = rule({ id: "hi", scope: "ALL", priority: 9 });
    expect(pickPriceRule([hi, prod], ctx({ productId: "gid://p/1" }))?.id).toBe("hi");
    expect(pickPriceRule([], ctx())).toBeNull();
  });
});

describe("evaluateVisibility — THE INVARIANT: no price in the decision", () => {
  it("returns SHOW_ALL when nothing matches", () => {
    expect(evaluateVisibility([], ctx())).toEqual(SHOW_ALL);
  });
  it("returns only hide flags + CTA label — never a price key", () => {
    const d = evaluateVisibility([rule({ scope: "LOGGED_OUT", hidePrice: true, hideAtc: true, ctaLabel: "Get a quote" })], ctx({ loggedIn: false }));
    expect(d).toEqual({ hidePrice: true, hideAtc: true, ctaLabel: "Get a quote" });
    const keys = Object.keys(d);
    expect(keys.sort()).toEqual(["ctaLabel", "hideAtc", "hidePrice"]);
    // No bare price/amount key may ever appear on a decision (hidePrice is a flag).
    expect(keys).not.toContain("price");
    expect(keys).not.toContain("amount");
  });
  it("a rule that hides nothing collapses to SHOW_ALL", () => {
    expect(evaluateVisibility([rule({ hidePrice: false, hideAtc: false })], ctx())).toEqual(SHOW_ALL);
  });
});

describe("priceRuleScopeAllowed gate (2-tier)", () => {
  it("broad scopes are Starter; targeted scopes are Growth", () => {
    expect(priceRuleScopeAllowed("STARTER", "ALL")).toBe(true);
    expect(priceRuleScopeAllowed("STARTER", "LOGGED_OUT")).toBe(true);
    expect(priceRuleScopeAllowed("STARTER", "CUSTOMER_TAG")).toBe(false);
    expect(priceRuleScopeAllowed("STARTER", "PRODUCT")).toBe(false);
    expect(priceRuleScopeAllowed("GROWTH", "COLLECTION")).toBe(true);
    expect(priceRuleScopeAllowed(null, "ALL")).toBe(false); // unpaid
  });
});
