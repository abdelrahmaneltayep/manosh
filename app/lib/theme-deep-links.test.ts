import { describe, it, expect } from "vitest";
import { STOREFRONT_BLOCKS, storefrontBlockLinks, themeEditorUrl } from "./theme-deep-links";
import { readdirSync } from "node:fs";

const KEY = "ad4c04f1bcb8aab2dc441ea8bf947a00";

describe("themeEditorUrl", () => {
  it("adds a product block to the main section of the product template", () => {
    expect(themeEditorUrl("acme.myshopify.com", KEY, "quote_button")).toBe(
      `https://acme.myshopify.com/admin/themes/current/editor?template=product&addAppBlockId=${KEY}/quote_button&target=mainSection`,
    );
  });
  it("adds the cart block in a new Apps section of the cart template", () => {
    expect(themeEditorUrl("acme.myshopify.com", KEY, "cart_to_quote")).toBe(
      `https://acme.myshopify.com/admin/themes/current/editor?template=cart&addAppBlockId=${KEY}/cart_to_quote&target=newAppsSection`,
    );
  });
  it("refuses a shop that isn't a myshopify domain, or a missing key", () => {
    expect(themeEditorUrl("evil.example.com", KEY, "price_gate")).toBeNull();
    expect(themeEditorUrl("acme.myshopify.com", undefined, "price_gate")).toBeNull();
    expect(themeEditorUrl("acme.myshopify.com", "bad key/../", "price_gate")).toBeNull();
  });
});

describe("STOREFRONT_BLOCKS", () => {
  it("matches the blocks the theme app extension ships (handle = Liquid filename)", () => {
    const files = readdirSync("extensions/quote-widget/blocks").filter((f) => f.endsWith(".liquid")).map((f) => f.replace(/\.liquid$/, "")).sort();
    expect(Object.keys(STOREFRONT_BLOCKS).sort()).toEqual(files);
  });
  it("builds links for a list of blocks", () => {
    const links = storefrontBlockLinks("acme.myshopify.com", KEY, ["make_offer_button"]);
    expect(links).toHaveLength(1);
    expect(links[0].name).toBe("Make an Offer");
    expect(links[0].url).toContain("addAppBlockId=");
  });
});
