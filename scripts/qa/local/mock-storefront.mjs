/*
 * A stand-in for the merchant's Online Store, for the local QA run: a password
 * page, products.json, a product page that renders the Mannon theme blocks with
 * the same data attributes as the Liquid, a cart, and the real extension
 * assets. The blocks call the app at `appUrl`, exactly like the live store.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ASSETS = fileURLToPath(new URL("../../../extensions/quote-widget/assets/", import.meta.url));
export const MOCK_STOREFRONT_PASSWORD = "letmein";

export function createMockStorefront({ shop, appUrl }) {
  let cart = [];
  const P = { id: 101, handle: "harbor-blend-espresso", title: "Harbor Blend Espresso", variants: [{ id: 9001, price: "21.50", sku: "HB-ESP-1KG" }] };
  const common = `data-shop="${shop}" data-app-url="${appUrl}"`;
  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/assets/quote-widget.css"><link rel="stylesheet" href="/assets/quote-capture.css"><link rel="stylesheet" href="/assets/make-an-offer.css"><link rel="stylesheet" href="/assets/price-gate.css"></head><body>${body}</body></html>`;
  const variant = `data-variant-id="gid://shopify/ProductVariant/9001" data-sku="HB-ESP-1KG"`;
  const pdp = () => page(P.title, `<h1>${P.title}</h1><div class="price">$21.50</div>
<form action="/cart/add"><button type="submit" name="add">Add to cart</button></form>
<div class="mannon-qw" data-mannon-qw ${common} data-source="PDP" data-product-title="${P.title}" ${variant}><button type="button" class="mannon-qw-btn" data-mannon-qw-open>Request a Quote</button></div>
<script src="/assets/quote-widget.js" defer></script>
<div class="mannon-atq" data-mannon-capture ${common} ${variant} data-title="${P.title}"><button type="button" class="mannon-atq-btn" data-mannon-atq-add>Add to Quote</button></div>
<script src="/assets/quote-capture.js" defer></script>
<div class="mannon-mao" data-mannon-mao ${common} data-source="PRODUCT" data-product-title="${P.title}" ${variant} data-list-price="21.50"><button type="button" class="mannon-mao-btn" data-mannon-mao-open>Make an offer</button></div>
<script src="/assets/make-an-offer.js" defer></script>
<div class="mannon-pg" data-mannon-pg ${common} data-logged-in="0" data-product-id="gid://shopify/Product/101" data-collection-ids="" data-price-selector=".price" data-atc-selector="[name='add']" data-quote-url=""><button type="button" class="mannon-pg-cta" hidden data-mannon-pg-cta>Request a Quote</button></div>
<script src="/assets/price-gate.js" defer></script>`);
  const cartPage = () => page("Cart", `<h1>Cart</h1><p>${cart.length} line(s)</p>
<div class="mannon-c2q" data-mannon-capture ${common}><button type="button" class="mannon-c2q-btn" data-mannon-c2q-btn>Request a quote for this cart</button></div>
<script src="/assets/quote-capture.js" defer></script>`);
  const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

  return http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const authed = /storefront_digest=ok/.test(req.headers.cookie || "");
    const send = (code, type, body, headers = {}) => { res.writeHead(code, { "Content-Type": type, ...headers }); res.end(body); };
    if (u.pathname.startsWith("/assets/")) {
      const f = u.pathname.slice(8).replace(/[^a-z0-9._-]/gi, "");
      try { return send(200, f.endsWith(".css") ? "text/css" : "application/javascript", readFileSync(ASSETS + f)); } catch { return send(404, "text/plain", "not found"); }
    }
    if (u.pathname === "/password") {
      if (req.method === "POST") {
        const ok = new URLSearchParams(await readBody(req)).get("password") === MOCK_STOREFRONT_PASSWORD;
        return send(302, "text/plain", "", ok ? { "Set-Cookie": "storefront_digest=ok; Path=/", Location: "/" } : { Location: "/password" });
      }
      return send(200, "text/html", page("Password", `<form method="post" action="/password"><label>Password <input type="password" name="password"></label><button>Enter</button></form>`));
    }
    if (!authed) return send(302, "text/plain", "", { Location: "/password" });
    if (u.pathname === "/") return send(200, "text/html", page("Home", `<a href="/products/${P.handle}">${P.title}</a>`));
    if (u.pathname === "/products.json") return send(200, "application/json", JSON.stringify({ products: [P] }));
    if (u.pathname === `/products/${P.handle}.js`) return send(200, "application/json", JSON.stringify(P));
    if (u.pathname === `/products/${P.handle}`) return send(200, "text/html", pdp());
    if (u.pathname === "/cart/add.js") {
      const items = JSON.parse((await readBody(req)) || "{}").items || [];
      items.forEach((i) => cart.push({ variant_id: i.id, quantity: i.quantity, product_title: P.title, sku: "HB-ESP-1KG" }));
      return send(200, "application/json", "{}");
    }
    if (u.pathname === "/cart.js") return send(200, "application/json", JSON.stringify({ items: cart }));
    if (u.pathname === "/cart/clear.js") { cart = []; return send(200, "application/json", "{}"); }
    if (u.pathname === "/cart") return send(200, "text/html", cartPage());
    send(404, "text/plain", "not found");
  });
}
