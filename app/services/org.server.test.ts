import { describe, it, expect } from "vitest";
import { canManage, storeHandle, storeAdminUrl } from "../lib/org";

// Pure helpers only — the DB-backed org functions are covered by the mocked
// Admin API path in integration and the Playwright happy-path.

describe("role-based access", () => {
  it("owners and managers can manage; viewers cannot", () => {
    expect(canManage("OWNER")).toBe(true);
    expect(canManage("MANAGER")).toBe(true);
    expect(canManage("VIEWER")).toBe(false);
    expect(canManage(null)).toBe(false);
  });
});

describe("store switch link (org-scoped navigation)", () => {
  it("derives the admin handle + apps URL", () => {
    expect(storeHandle("acme.myshopify.com")).toBe("acme");
    expect(storeAdminUrl("acme.myshopify.com")).toBe("https://admin.shopify.com/store/acme/apps");
  });
});
