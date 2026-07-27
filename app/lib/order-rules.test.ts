import { describe, it, expect } from "vitest";
import {
  adjustLine,
  evaluateCart,
  matchingRules,
  roundUpToMultiple,
  shortfallMessage,
  type OrderRuleLite,
} from "./order-rules";

const store = (o: Partial<OrderRuleLite> = {}): OrderRuleLite => ({
  scope: "STORE", targetId: null, minQty: null, packSize: null, minOrderValue: null, priority: 0, ...o,
});
const product = (variantId: string, o: Partial<OrderRuleLite> = {}): OrderRuleLite => ({
  scope: "PRODUCT", targetId: variantId, minQty: null, packSize: null, minOrderValue: null, priority: 0, ...o,
});

describe("roundUpToMultiple", () => {
  it("rounds up to the nearest multiple", () => {
    expect(roundUpToMultiple(20, 12)).toBe(24);
    expect(roundUpToMultiple(24, 12)).toBe(24);
    expect(roundUpToMultiple(1, 12)).toBe(12);
  });
  it("no-ops for multiple <= 1", () => {
    expect(roundUpToMultiple(20, 1)).toBe(20);
  });
});

describe("adjustLine", () => {
  it("rounds a qty of 20 up to 24 for a pack size of 12, with an explanation", () => {
    const a = adjustLine(20, [product("v1", { packSize: 12 })], { variantId: "v1" });
    expect(a.finalQty).toBe(24);
    expect(a.changed).toBe(true);
    expect(a.reason).toMatch(/cases of 12 — rounded to 24/);
  });

  it("raises to the MOQ when below it", () => {
    const a = adjustLine(3, [product("v1", { minQty: 10 })], { variantId: "v1" });
    expect(a.finalQty).toBe(10);
    expect(a.reason).toMatch(/minimum order of 10/);
  });

  it("combines MOQ + pack (min then rounds to a pack boundary)", () => {
    const a = adjustLine(2, [product("v1", { minQty: 10, packSize: 12 })], { variantId: "v1" });
    expect(a.finalQty).toBe(12); // max(2,10)=10 → round to 12
  });

  it("leaves a valid qty untouched", () => {
    const a = adjustLine(24, [product("v1", { packSize: 12 })], { variantId: "v1" });
    expect(a.changed).toBe(false);
    expect(a.reason).toBeNull();
  });

  it("applies the store rule when no product rule matches", () => {
    const a = adjustLine(5, [store({ minQty: 6 })], { variantId: "v9" });
    expect(a.finalQty).toBe(6);
  });
});

describe("specificity (product > group > store)", () => {
  it("the product rule wins over the store rule", () => {
    const rules = [store({ packSize: 6 }), product("v1", { packSize: 12 })];
    expect(matchingRules(rules, { variantId: "v1" })[0].scope).toBe("PRODUCT");
    expect(adjustLine(20, rules, { variantId: "v1" }).finalQty).toBe(24);
  });
  it("a customer-group rule overrides the store rule", () => {
    const rules: OrderRuleLite[] = [
      store({ minQty: 5 }),
      { scope: "CUSTOMER_GROUP", targetId: "co1", minQty: 20, packSize: null, minOrderValue: null, priority: 0 },
    ];
    expect(adjustLine(1, rules, { variantId: "v1", companyId: "co1" }).finalQty).toBe(20);
    // a different company falls back to the store rule
    expect(adjustLine(1, rules, { variantId: "v1", companyId: "other" }).finalQty).toBe(5);
  });
});

describe("evaluateCart", () => {
  it("adjusts lines and flags a cart under the store minimum with the shortfall", () => {
    const rules = [store({ minOrderValue: 250 }), product("v1", { packSize: 12 })];
    const cart = evaluateCart(
      [{ variantId: "v1", qty: 20, price: 5 }],
      rules,
    );
    expect(cart.lines[0].finalQty).toBe(24); // rounded
    expect(cart.subtotal).toBe(120); // 24 * 5
    expect(cart.minOrderValue).toBe(250);
    expect(cart.shortfall).toBe(130);
    expect(cart.ok).toBe(false);
  });

  it("passes when the subtotal clears the minimum", () => {
    const cart = evaluateCart([{ variantId: "v1", qty: 60, price: 5 }], [store({ minOrderValue: 250 })]);
    expect(cart.subtotal).toBe(300);
    expect(cart.shortfall).toBe(0);
    expect(cart.ok).toBe(true);
  });

  it("never drops a line", () => {
    const cart = evaluateCart([{ variantId: "v1", qty: 0, price: 5 }], [product("v1", { minQty: 10 })]);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].finalQty).toBe(10);
  });
});

describe("shortfallMessage", () => {
  it("tells the buyer how much more to add", () => {
    expect(shortfallMessage("USD", 130, 250)).toMatch(/Add USD 130.00 more to meet the USD 250.00 minimum/);
  });
});
