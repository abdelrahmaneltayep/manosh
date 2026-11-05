/**
 * Theme editor deep links for Mannon's theme app extension blocks (App Store
 * requirement 5.1.3). One click opens the merchant's live theme in the theme
 * editor with the block already placed; nothing is saved until they click Save.
 *
 * Format confirmed against shopify.dev (Theme app extensions → Configuration →
 * Deep linking, 2026-11-05):
 *   https://{shop}/admin/themes/current/editor?template={template}
 *     &addAppBlockId={api_key}/{handle}&target=mainSection|newAppsSection
 * `api_key` is the app's client_id; `handle` is the block's Liquid filename in
 * extensions/quote-widget/blocks/. Pure and client-safe.
 */

export type StorefrontBlockHandle = "quote_button" | "add_to_quote" | "cart_to_quote" | "make_offer_button" | "price_gate";

export interface StorefrontBlock {
  handle: StorefrontBlockHandle;
  /** The block's name in the theme editor (its schema "name"). */
  name: string;
  /** What the block does, in one plain sentence. */
  what: string;
  template: "product" | "cart";
  /** The product page's main section holds the buy buttons; a cart template's main section id varies by theme, so cart blocks go in a new Apps section. */
  target: "mainSection" | "newAppsSection";
}

export const STOREFRONT_BLOCKS: Record<StorefrontBlockHandle, StorefrontBlock> = {
  quote_button: { handle: "quote_button", name: "Request a Quote", what: "A button on the product page that opens a short quote request form.", template: "product", target: "mainSection" },
  add_to_quote: { handle: "add_to_quote", name: "Add to Quote", what: "Lets buyers collect products across pages and send one quote request.", template: "product", target: "mainSection" },
  cart_to_quote: { handle: "cart_to_quote", name: "Convert Cart to Quote", what: "Turns the buyer's cart into a quote request.", template: "cart", target: "newAppsSection" },
  make_offer_button: { handle: "make_offer_button", name: "Make an Offer", what: "Lets buyers name their price; your offer rules answer it.", template: "product", target: "mainSection" },
  price_gate: { handle: "price_gate", name: "Price / ATC gate", what: "Applies your price rules: hides prices or Add to cart for the visitors you choose.", template: "product", target: "mainSection" },
};

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** The theme editor URL that adds `handle` to the live theme. Null when the shop or key is unusable. Pure. */
export function themeEditorUrl(shopDomain: string, apiKey: string | undefined, handle: StorefrontBlockHandle): string | null {
  const shop = (shopDomain || "").trim().toLowerCase();
  const key = (apiKey || "").trim();
  const block = STOREFRONT_BLOCKS[handle];
  if (!SHOP_RE.test(shop) || !/^[A-Za-z0-9]+$/.test(key) || !block) return null;
  return `https://${shop}/admin/themes/current/editor?template=${block.template}&addAppBlockId=${key}/${block.handle}&target=${block.target}`;
}

export interface StorefrontBlockLink extends StorefrontBlock {
  url: string | null;
}

/** Links for the given blocks, ready for a loader to return. Pure. */
export function storefrontBlockLinks(shopDomain: string, apiKey: string | undefined, handles: StorefrontBlockHandle[]): StorefrontBlockLink[] {
  return handles.map((h) => ({ ...STOREFRONT_BLOCKS[h], url: themeEditorUrl(shopDomain, apiKey, h) }));
}
