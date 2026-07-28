import { describe, it, expect } from "vitest";
import {
  slugify,
  uniqueSlug,
  pricesVisibleOnPublicPage,
  priceNotice,
  validateLead,
  buildPublicMeta,
  isHoneypotTripped,
  HONEYPOT_FIELD,
} from "./public-catalog";
import { catalogSharingAllowed } from "./billing";

describe("plan gating", () => {
  it("catalog sharing is Growth-only", () => {
    expect(catalogSharingAllowed("GROWTH")).toBe(true);
    expect(catalogSharingAllowed("STARTER")).toBe(false);
    expect(catalogSharingAllowed(null)).toBe(false);
  });
});

describe("price protection (the guarantee)", () => {
  it("prices show on the public page ONLY when showPrices = PUBLIC", () => {
    expect(pricesVisibleOnPublicPage("PUBLIC")).toBe(true);
    expect(pricesVisibleOnPublicPage("AFTER_APPROVAL")).toBe(false);
    expect(pricesVisibleOnPublicPage("HIDDEN")).toBe(false);
  });
  it("explains the price state, and hides it by default", () => {
    expect(priceNotice("PUBLIC")).toBeNull();
    expect(priceNotice("AFTER_APPROVAL")).toMatch(/approved/i);
    expect(priceNotice("HIDDEN")).toMatch(/approved/i);
  });
});

describe("slugify", () => {
  it("produces URL-safe slugs and never empty", () => {
    expect(slugify("Spring 2026 Wholesale!")).toBe("spring-2026-wholesale");
    expect(slugify("  --  ")).toBe("catalog");
    expect(slugify("")).toBe("catalog");
  });
});

describe("uniqueSlug", () => {
  it("appends a suffix on collision", () => {
    expect(uniqueSlug("Spring Line", [])).toBe("spring-line");
    expect(uniqueSlug("Spring Line", ["spring-line"])).toBe("spring-line-2");
    expect(uniqueSlug("Spring Line", ["spring-line", "spring-line-2"])).toBe("spring-line-3");
  });
});

describe("validateLead", () => {
  it("requires a valid email; trims + caps the rest", () => {
    expect(validateLead({ email: "not-an-email" }).ok).toBe(false);
    const v = validateLead({ email: "  Buyer@Shop.com ", companyName: "  Acme  ", message: "  hi  " });
    expect(v).toMatchObject({ ok: true, email: "buyer@shop.com", companyName: "Acme", message: "hi" });
  });
  it("empty company/message become null", () => {
    const v = validateLead({ email: "a@b.co" });
    expect(v.companyName).toBeNull();
    expect(v.message).toBeNull();
  });
});

describe("buildPublicMeta", () => {
  it("builds an SEO title + description", () => {
    const m = buildPublicMeta("Spring Line", "acme.myshopify.com", 12);
    expect(m.title).toBe("Spring Line — Wholesale");
    expect(m.description).toContain("12 wholesale products");
    expect(buildPublicMeta("", "acme", 0).title).toBe("Wholesale catalog — Wholesale");
  });
});

describe("honeypot (shared with F6)", () => {
  it("re-exports the spam guard", () => {
    expect(HONEYPOT_FIELD).toBeTruthy();
    expect(isHoneypotTripped("bot")).toBe(true);
    expect(isHoneypotTripped("")).toBe(false);
  });
});
