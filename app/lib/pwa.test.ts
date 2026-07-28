import { describe, it, expect } from "vitest";
import {
  buildManifest,
  brandIconSvg,
  normalizeShortcutLines,
  validateShortcut,
  reorderPushPayload,
  SW_CACHE_NAME,
  SW_SCOPE,
} from "./pwa";
import { pushRemindersAllowed, evaluateShortcutAllowance, PLAN_LIMITS } from "./billing";

describe("plan gating", () => {
  it("PWA + one-tap reorder on both plans; push is Growth; Starter caps shortcuts at 1", () => {
    expect(pushRemindersAllowed("GROWTH")).toBe(true);
    expect(pushRemindersAllowed("STARTER")).toBe(false);
    expect(PLAN_LIMITS.starter.reorderShortcutCap).toBe(1);
    expect(Number.isFinite(PLAN_LIMITS.growth.reorderShortcutCap)).toBe(false);
  });
  it("evaluateShortcutAllowance allows while used < cap", () => {
    expect(evaluateShortcutAllowance(0, 1).allowed).toBe(true);
    expect(evaluateShortcutAllowance(1, 1).allowed).toBe(false);
    expect(evaluateShortcutAllowance(9, Infinity).allowed).toBe(true);
  });
});

describe("buildManifest", () => {
  it("uses the brand tokens + a scoped standalone start url", () => {
    const m = buildManifest("Acme Supply", "/portal/icon.svg");
    expect(m.theme_color).toBe("#4F46E5");
    expect(m.background_color).toBe("#1A1A2E");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/portal");
    expect(m.scope).toBe(SW_SCOPE);
    expect(m.icons.some((i) => i.purpose?.includes("maskable"))).toBe(true);
    expect(m.short_name.length).toBeLessThanOrEqual(12);
  });
});

describe("brandIconSvg", () => {
  it("is an SVG on brand", () => {
    const svg = brandIconSvg();
    expect(svg).toContain("<svg");
    expect(svg).toContain("#4F46E5");
    expect(svg).toContain("#A3E635");
  });
});

describe("SW cache versioning", () => {
  it("cache name carries the version (bump to invalidate stale caches)", () => {
    expect(SW_CACHE_NAME).toMatch(/^mannon-portal-v\d+$/);
  });
});

describe("shortcut validation", () => {
  it("normalizes lines and floors quantity", () => {
    expect(normalizeShortcutLines([{ variantId: "v1", quantity: "3" }, { variantId: "", quantity: 2 }, { quantity: 5 }]))
      .toEqual([{ variantId: "v1", quantity: 3 }]);
  });
  it("rejects an empty shortcut, defaults the label", () => {
    expect(validateShortcut("", []).ok).toBe(false);
    const v = validateShortcut("", [{ variantId: "v1", quantity: 1 }]);
    expect(v).toMatchObject({ ok: true, label: "Usual order" });
  });
});

describe("reorderPushPayload", () => {
  it("names the shop + shortcut and links to /portal/shortcuts", () => {
    const p = reorderPushPayload("Acme", "Weekly restock", "https://x.fly.dev/");
    expect(p.title).toContain("Acme");
    expect(p.body).toContain("Weekly restock");
    expect(p.url).toBe("https://x.fly.dev/portal/shortcuts");
  });
});
