import { describe, it, expect } from "vitest";
import {
  parseStockUpdates,
  resolveStock,
  oversellCheck,
  oversellMessage,
  normalizeOrder,
  syncLagExceeded,
  type RawOrder,
} from "./erp";
import { erpSyncAllowed } from "./billing";

describe("plan gating", () => {
  it("ERP sync is Growth-only", () => {
    expect(erpSyncAllowed("GROWTH")).toBe(true);
    expect(erpSyncAllowed("Growth")).toBe(true);
    expect(erpSyncAllowed("STARTER")).toBe(false);
    expect(erpSyncAllowed(null)).toBe(false);
  });
});

describe("parseStockUpdates", () => {
  it("parses a CSV with a header, clamps negatives to 0", () => {
    const { updates, errors } = parseStockUpdates("variant_id,qty\ngid://v/1,12\ngid://v/2,-3\n");
    expect(errors).toHaveLength(0);
    expect(updates).toEqual([
      { variantId: "gid://v/1", qty: 12 },
      { variantId: "gid://v/2", qty: 0 },
    ]);
  });
  it("parses a JSON array with flexible keys", () => {
    const { updates } = parseStockUpdates([{ variant_id: "v1", available: 5 }, { sku: "v2", qty: 9 }]);
    expect(updates).toEqual([{ variantId: "v1", qty: 5 }, { variantId: "v2", qty: 9 }]);
  });
  it("flags malformed rows", () => {
    const { errors } = parseStockUpdates([{ qty: 5 }]);
    expect(errors[0]).toMatch(/missing variant id/);
  });
});

describe("resolveStock (source of truth)", () => {
  it("ERP source: ERP qty governs", () => {
    expect(resolveStock("ERP", 100, 4)).toEqual({ qty: 4, governing: "ERP" });
  });
  it("Shopify source: Shopify qty governs", () => {
    expect(resolveStock("SHOPIFY", 100, 4)).toEqual({ qty: 100, governing: "SHOPIFY" });
  });
  it("falls back to the other side when one is missing", () => {
    expect(resolveStock("ERP", 100, null).qty).toBe(100);
    expect(resolveStock("SHOPIFY", null, 4).qty).toBe(4);
  });
});

describe("oversellCheck (never oversell)", () => {
  it("blocks when requested exceeds available", () => {
    expect(oversellCheck(3, 10)).toEqual({ ok: false, available: 3, requested: 10, shortfall: 7 });
  });
  it("allows within stock", () => {
    expect(oversellCheck(10, 10).ok).toBe(true);
  });
  it("allows when there's no stock signal (null)", () => {
    expect(oversellCheck(null, 999).ok).toBe(true);
  });
  it("has a plain-language message", () => {
    expect(oversellMessage("KMB-S", 3, 10)).toMatch(/Only 3 of “KMB-S” are in stock/);
  });
});

describe("normalizeOrder", () => {
  it("reshapes an order without recomputing money", () => {
    const raw: RawOrder = {
      id: "clorder1234",
      companyName: "Cedar & Co.",
      currency: "USD",
      total: "2516.00",
      placedAt: new Date("2026-07-28T00:00:00Z"),
      poReference: "PO-9",
      lines: [{ sku: "A", variantId: "gid://v/1", quantity: 24, price: "84.00" }],
    };
    const n = normalizeOrder(raw);
    expect(n.total).toBe("2516.00");
    expect(n.reference).toMatch(/^MANNON-/);
    expect(n.poNumber).toBe("PO-9");
    expect(n.lines[0]).toEqual({ sku: "A", variantId: "gid://v/1", quantity: 24, unitPrice: "84.00" });
  });
});

describe("syncLagExceeded", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  it("true once past the lag window", () => {
    expect(syncLagExceeded(new Date("2026-07-28T09:00:00Z"), now, 120)).toBe(true);
    expect(syncLagExceeded(new Date("2026-07-28T11:00:00Z"), now, 120)).toBe(false);
    expect(syncLagExceeded(null, now, 120)).toBe(false);
  });
});
