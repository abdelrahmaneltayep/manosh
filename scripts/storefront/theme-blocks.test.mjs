import { describe, expect, it } from "vitest";
import { acceptsAppBlocks, addCartBlock, addProductBlocks, joinTemplate, mannonBlocks, splitTemplate } from "./theme-blocks.mjs";

const T = "shopify://apps/mannon/blocks/add_to_quote/575bdd12-c148-17fc-58da-85b0e6a5c9b61376e3ed";
const HEAD = "/*\n * ------------------------------------------------------------\n * IMPORTANT: The contents of this file are auto-generated.\n * ------------------------------------------------------------\n */\n";

const dawnProduct = () => HEAD + JSON.stringify({
  sections: {
    main: {
      type: "main-product",
      blocks: {
        title: { type: "title", settings: {} },
        buy_buttons: { type: "buy_buttons", settings: {} },
        mannon_rfq: { type: T.replace("add_to_quote", "quote_button"), settings: {} },
        mannon_atq: { type: T, settings: {} },
        mannon_mao: { type: T.replace("add_to_quote", "make_offer_button"), settings: {} },
        share: { type: "share", settings: {} },
      },
      block_order: ["title", "buy_buttons", "mannon_rfq", "mannon_atq", "mannon_mao", "share"],
      settings: {},
    },
    related: { type: "related-products", settings: {} },
  },
  order: ["main", "related"],
});

const horizonProduct = () => JSON.stringify({
  sections: {
    main: {
      type: "product-information",
      blocks: {
        details: {
          type: "_product-details",
          blocks: {
            price: { type: "price", settings: {} },
            mannon_atq: { type: T, settings: {} },
          },
          block_order: ["price", "mannon_atq"],
          settings: {},
        },
      },
      block_order: ["details"],
      settings: {},
    },
  },
  order: ["main"],
});

const dawnCart = () => JSON.stringify({
  sections: {
    "cart-items": { type: "main-cart-items", settings: {} },
    "cart-footer": { type: "main-cart-footer", blocks: { subtotal: { type: "subtotal", settings: {} }, buttons: { type: "buttons", settings: {} } }, block_order: ["subtotal", "buttons"], settings: {} },
  },
  order: ["cart-items", "cart-footer"],
});

const schema = (blocks) => `<div></div>\n{% schema %}\n${JSON.stringify({ name: "x", blocks })}\n{% endschema %}\n`;
const SECTIONS = {
  "main-cart-items": schema([]),
  "main-cart-footer": schema([{ type: "subtotal" }, { type: "buttons" }, { type: "@app" }]),
  apps: schema([{ type: "@app" }]),
};
const lookup = (map) => (type) => (type in map ? map[type] : null);

describe("theme block helpers", () => {
  it("keeps the generated comment header round-trip", () => {
    const { head, json } = splitTemplate(dawnProduct());
    expect(head).toBe(HEAD);
    expect(joinTemplate(head, json).startsWith(HEAD)).toBe(true);
    expect(JSON.parse(joinTemplate(head, json).slice(HEAD.length))).toEqual(json);
  });

  it("adds the price gate next to the Mannon blocks on a Dawn product template", () => {
    const { json } = splitTemplate(dawnProduct());
    const r = addProductBlocks(json);
    expect(r.changed).toBe(true);
    const main = json.sections.main;
    expect(main.block_order).toEqual(["title", "buy_buttons", "mannon_rfq", "mannon_atq", "mannon_mao", "mannon_price_gate", "share"]);
    expect(main.blocks.mannon_price_gate.type).toBe(T.replace("add_to_quote", "price_gate"));
    // nothing else moved
    expect(Object.keys(main.blocks)).toHaveLength(7);
    expect(json.order).toEqual(["main", "related"]);
  });

  it("adds it inside a nested Horizon block container and is idempotent", () => {
    const { json } = splitTemplate(horizonProduct());
    addProductBlocks(json);
    const details = json.sections.main.blocks.details;
    expect(details.block_order).toEqual(["price", "mannon_atq", "mannon_price_gate"]);
    const again = addProductBlocks(json);
    expect(again.changed).toBe(false);
    expect(mannonBlocks(json).filter((b) => b.handle === "price_gate")).toHaveLength(1);
  });

  it("refuses when there is no Mannon block to copy the app reference from", () => {
    const { json } = splitTemplate(JSON.stringify({ sections: { main: { type: "main-product", blocks: {}, block_order: [] } }, order: ["main"] }));
    expect(() => addProductBlocks(json)).toThrow(/no Mannon block/);
  });

  it("puts Convert Cart to Quote in the cart section that accepts app blocks", () => {
    const { json } = splitTemplate(dawnCart());
    const r = addCartBlock(json, T, lookup(SECTIONS));
    expect(r.changed).toBe(true);
    const footer = json.sections["cart-footer"];
    expect(footer.block_order).toEqual(["subtotal", "buttons", "mannon_cart_to_quote"]);
    expect(footer.blocks.mannon_cart_to_quote.type).toBe(T.replace("add_to_quote", "cart_to_quote"));
    expect(json.sections["cart-items"].blocks).toBeUndefined();
    expect(addCartBlock(json, T, lookup(SECTIONS)).changed).toBe(false);
  });

  it("falls back to an Apps section when no cart section accepts app blocks", () => {
    const { json } = splitTemplate(dawnCart());
    addCartBlock(json, T, lookup({ "main-cart-items": schema([]), "main-cart-footer": schema([{ type: "subtotal" }]), apps: schema([{ type: "@app" }]) }));
    expect(json.order).toEqual(["cart-items", "mannon_apps", "cart-footer"]);
    expect(json.sections.mannon_apps.type).toBe("apps");
  });

  it("gives up cleanly when neither option exists", () => {
    const { json } = splitTemplate(dawnCart());
    expect(() => addCartBlock(json, T, lookup({ "main-cart-items": schema([]), "main-cart-footer": schema([]) }))).toThrow(/theme editor/);
  });

  it("reads @app support from a section schema", () => {
    expect(acceptsAppBlocks(SECTIONS["main-cart-footer"])).toBe(true);
    expect(acceptsAppBlocks(SECTIONS["main-cart-items"])).toBe(false);
    expect(acceptsAppBlocks(null)).toBe(false);
  });
});
