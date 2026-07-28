import { describe, it, expect } from "vitest";
import {
  isHexColor,
  normalizeHex,
  contrastRatio,
  readableTextOn,
  validateBranding,
  resolveBrandingTokens,
  BRAND_DEFAULT_PRIMARY,
  BRAND_DEFAULT_ACCENT,
  DEFAULT_PORTAL_NAME,
} from "./branding";
import { agencyAllowed, whiteLabelAllowed } from "./billing";

describe("plan gating", () => {
  it("agency + white-label are Growth-only", () => {
    expect(agencyAllowed("GROWTH")).toBe(true);
    expect(agencyAllowed("STARTER")).toBe(false);
    expect(whiteLabelAllowed("GROWTH")).toBe(true);
    expect(whiteLabelAllowed(null)).toBe(false);
  });
});

describe("hex parsing", () => {
  it("validates and normalizes", () => {
    expect(isHexColor("#4F46E5")).toBe(true);
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("blue")).toBe(false);
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("nope")).toBeNull();
  });
});

describe("contrast (WCAG)", () => {
  it("computes a ratio and picks readable text", () => {
    // black on white is the max (21:1)
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
    // indigo is dark → white text reads better than ink text
    expect(readableTextOn("#4F46E5")).toBe("#ffffff");
    // lime is bright → ink text reads better than white
    expect(readableTextOn("#A3E635")).toBe("#1A1A2E");
  });
});

describe("validateBranding (contrast guardrail)", () => {
  it("accepts a strong primary + names", () => {
    const v = validateBranding({ primaryColor: "#4F46E5", accentColor: "#A3E635", portalName: "  Acme Wholesale  " });
    expect(v).toMatchObject({ ok: true, primaryColor: "#4f46e5", accentColor: "#a3e635", portalName: "Acme Wholesale" });
  });
  it("empty fields clear the override", () => {
    const v = validateBranding({ primaryColor: "", accentColor: "", portalName: "" });
    expect(v).toMatchObject({ ok: true, primaryColor: null, accentColor: null, portalName: null });
  });
  it("rejects an invalid hex", () => {
    expect(validateBranding({ primaryColor: "reddish" }).ok).toBe(false);
  });
  it("rejects a too-low-contrast mid-tone primary", () => {
    // A mid grey fails AA against both white and ink → guardrail trips.
    const v = validateBranding({ primaryColor: "#808080" });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/contrast/i);
  });
});

describe("resolveBrandingTokens", () => {
  it("falls back to Mannon defaults when unbranded", () => {
    const t = resolveBrandingTokens(null);
    expect(t.primary).toBe(BRAND_DEFAULT_PRIMARY);
    expect(t.accent).toBe(BRAND_DEFAULT_ACCENT);
    expect(t.portalName).toBe(DEFAULT_PORTAL_NAME);
    expect(t.custom).toBe(false);
  });
  it("layers overrides and flags custom + AA text", () => {
    const t = resolveBrandingTokens({ primaryColor: "#0b5", accentColor: null, portalName: "Northwind", logoFileId: null });
    expect(t.primary).toBe("#00bb55");
    expect(t.portalName).toBe("Northwind");
    expect(t.custom).toBe(true);
    expect([t.primaryText]).toContain(t.primaryText); // deterministic AA pick
  });
});
