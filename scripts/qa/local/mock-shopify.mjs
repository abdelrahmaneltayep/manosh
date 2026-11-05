/*
 * A stand-in for the Shopify Admin GraphQL API, for the local full QA run
 * (`npm run qa:all -- --local`). The served build reaches it through
 * preload.mjs, which sends every https://<shop>.myshopify.com request here.
 *
 * It answers the operations Mannon makes (by operation name), keeps draft
 * orders it "creates", and records every call so section A can check what the
 * app asked Shopify to do. Money math here plays Shopify's part (10% tax); the
 * app never computes totals itself. Unknown operations get `{ data: {} }` and
 * are listed at GET /__calls so gaps show up in the report.
 */
import http from "node:http";

const CURRENCY = "USD";
const TAX_RATE = 0.1;

export const MOCK_CATALOG = [
  { productId: "gid://shopify/Product/1", title: "Stoneware Mug", variants: [{ id: "gid://shopify/ProductVariant/1", sku: "MUG-12", title: "12oz", price: "9.50" }] },
  { productId: "gid://shopify/Product/101", title: "Harbor Blend Espresso", variants: [{ id: "gid://shopify/ProductVariant/9001", sku: "HB-ESP-1KG", title: "Default Title", price: "21.50" }] },
  { productId: "gid://shopify/Product/2", title: "Untracked Sample", variants: [{ id: "gid://shopify/ProductVariant/2", sku: "sku-untracked-1", title: "Default Title", price: "12.00" }] },
  { productId: "gid://shopify/Product/3", title: "Managed Sample", variants: [{ id: "gid://shopify/ProductVariant/3", sku: "sku-managed-1", title: "Default Title", price: "30.00" }] },
];
const variants = new Map(MOCK_CATALOG.flatMap((p) => p.variants.map((v) => [v.id, { ...v, productTitle: p.title }])));

export const MOCK_COMPANY = {
  id: "gid://shopify/Company/1",
  name: "Acme Wholesale Co.",
  locationId: "gid://shopify/CompanyLocation/1",
  contactId: "gid://shopify/CompanyContact/1",
};

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);
const set = (n) => ({ shopMoney: { amount: money(n), currencyCode: CURRENCY }, presentmentMoney: { amount: money(n), currencyCode: CURRENCY } });

function totalsFor(input) {
  const subtotal = (input?.lineItems || []).reduce((s, l) => {
    const unit = Number(l.priceOverride?.amount ?? l.originalUnitPrice ?? variants.get(l.variantId)?.price ?? 0);
    return s + unit * Number(l.quantity || 0);
  }, 0);
  const tax = input?.taxExempt ? 0 : subtotal * TAX_RATE;
  return { subtotalPriceSet: set(subtotal), totalTaxSet: set(tax), totalPriceSet: set(subtotal + tax) };
}

function lineErrors(input) {
  return (input?.lineItems || []).filter((l) => !variants.has(l.variantId)).map((l) => ({ field: ["lineItems", "variantId"], message: `Variant ${l.variantId} does not exist` }));
}

export function createMockShopify() {
  const calls = [];
  const drafts = new Map();
  const orders = [
    { id: "gid://shopify/Order/1001", name: "#1001", createdAt: "2026-10-01T10:00:00Z", lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 24 }, { variantId: "gid://shopify/ProductVariant/9001", quantity: 6 }] },
  ];
  let nextDraft = 5001;

  const ops = {
    MannonCatalog: () => ({
      shop: { currencyCode: CURRENCY },
      products: { nodes: MOCK_CATALOG.map((p) => ({ id: p.productId, title: p.title, isGiftCard: false, variants: { nodes: p.variants } })) },
    }),
    MannonPaymentTerms: () => ({
      paymentTermsTemplates: [
        { id: "gid://shopify/PaymentTermsTemplate/1", name: "Due on receipt", paymentTermsType: "RECEIPT", dueInDays: null },
        { id: "gid://shopify/PaymentTermsTemplate/4", name: "Net 30", paymentTermsType: "NET", dueInDays: 30 },
        { id: "gid://shopify/PaymentTermsTemplate/5", name: "Net 60", paymentTermsType: "NET", dueInDays: 60 },
      ],
    }),
    MannonVariantCosts: (v) => ({ nodes: (v.ids || []).map((id) => (variants.has(id) ? { id, inventoryItem: { unitCost: { amount: money(Number(variants.get(id).price) * 0.55), currencyCode: CURRENCY } } } : null)) }),
    MannonReorderOrder: (v) => {
      const o = orders.find((x) => x.id === v.id);
      if (!o) return { order: null };
      return { order: { lineItems: { nodes: o.lines.map((l) => { const vr = variants.get(l.variantId); return { quantity: l.quantity, name: vr.productTitle, sku: vr.sku, variant: { id: l.variantId }, originalUnitPriceSet: { shopMoney: { amount: vr.price } } }; }) } } };
    },
    MannonDraftOrderCalculate: (v) => {
      const errs = lineErrors(v.input);
      return { draftOrderCalculate: { calculatedDraftOrder: errs.length ? null : totalsFor(v.input), userErrors: errs } };
    },
    MannonDraftOrderCreate: (v) => {
      const errs = lineErrors(v.input);
      if (errs.length) return { draftOrderCreate: { draftOrder: null, userErrors: errs } };
      const id = `gid://shopify/DraftOrder/${nextDraft++}`;
      const d = { id, name: `#D${nextDraft - 5001}`, input: v.input, ...totalsFor(v.input), status: "OPEN", createdAt: new Date().toISOString() };
      drafts.set(id, d);
      return { draftOrderCreate: { draftOrder: { id, subtotalPriceSet: d.subtotalPriceSet, totalTaxSet: d.totalTaxSet, totalPriceSet: d.totalPriceSet }, userErrors: [] } };
    },
    MannonDraftOrderInvoiceSend: (v) => ({ draftOrderInvoiceSend: drafts.has(v.id) ? { draftOrder: { id: v.id }, userErrors: [] } : { draftOrder: null, userErrors: [{ field: ["id"], message: "Draft order not found" }] } }),
    MannonDemoCompany: () => ({ companies: { nodes: [{ id: MOCK_COMPANY.id, name: MOCK_COMPANY.name, locations: { nodes: [{ id: MOCK_COMPANY.locationId }] }, contacts: { nodes: [{ id: MOCK_COMPANY.contactId }] } }] } }),
    MannonDemoOrders: (v) => ({ orders: { nodes: orders.slice(0, v.first || 3).map((o) => ({ id: o.id, name: o.name, createdAt: o.createdAt, totalPriceSet: { shopMoney: { amount: totalsFor({ lineItems: o.lines }).totalPriceSet.shopMoney.amount, currencyCode: CURRENCY } } })) } }),
    MannonDemoSeedOrder: (v) => {
      const d = drafts.get(v.id);
      if (!d) return { draftOrderComplete: { draftOrder: null, userErrors: [{ field: ["id"], message: "Draft order not found" }] } };
      const o = { id: `gid://shopify/Order/${2000 + orders.length}`, name: `#${2000 + orders.length}`, createdAt: new Date().toISOString(), lines: d.input.lineItems.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) };
      orders.unshift(o);
      d.status = "COMPLETED";
      return { draftOrderComplete: { draftOrder: { order: { id: o.id, name: o.name, createdAt: o.createdAt, totalPriceSet: d.totalPriceSet } }, userErrors: [] } };
    },
    // Shopify's billing check (shopify-api's own query): one active, test-mode
    // subscription named after MANNON_QA_PLAN (default Scale, so every page opens).
    appSubscription: () => ({
      currentAppInstallation: {
        activeSubscriptions: [{
          id: "gid://shopify/AppSubscription/1", name: process.env.MANNON_QA_PLAN || "Scale", test: true, status: "ACTIVE", trialDays: 0,
          createdAt: "2026-10-01T00:00:00Z", currentPeriodEnd: "2026-12-01T00:00:00Z", returnUrl: "https://example.com",
          lineItems: [{ id: "gid://shopify/AppSubscriptionLineItem/1", plan: { pricingDetails: { __typename: "AppRecurringPricing", price: { amount: "69.0", currencyCode: "USD" }, interval: "EVERY_30_DAYS", discount: null } } }],
        }],
        oneTimePurchases: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    }),
    MannonAppHandle: () => ({ currentAppInstallation: { app: { handle: "mannon" } } }),
    MannonCustomerEmail: () => ({ node: { email: "buyer@acme-wholesale.example" } }),
    FindCustomer: () => ({ customers: { nodes: [] } }),
    AddTags: (v) => ({ tagsAdd: { node: { id: v.id }, userErrors: [] } }),
  };

  const server = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, "http://mock");
    if (req.method === "GET" && url.pathname === "/__calls") return send(200, { calls });
    if (req.method === "GET" && url.pathname === "/__state") return send(200, { drafts: [...drafts.values()], orders });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const shop = req.headers["x-mannon-shop"] || "unknown";
      if (url.pathname.endsWith("/oauth/access_token")) {
        calls.push({ at: new Date().toISOString(), shop, op: "tokenExchange", known: true });
        return send(200, { access_token: "shpat_local_mock", scope: process.env.SCOPES || "" });
      }
      if (!/\/admin\/api\/[^/]+\/graphql\.json$/.test(url.pathname)) {
        calls.push({ at: new Date().toISOString(), shop, op: `${req.method} ${url.pathname}`, known: false });
        return send(404, { errors: "Not Found" });
      }
      let q = {};
      try { q = JSON.parse(body || "{}"); } catch { return send(400, { errors: "bad json" }); }
      const name = (String(q.query || "").match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/) || [])[1] || q.operationName || "(anonymous)";
      const fn = ops[name];
      calls.push({ at: new Date().toISOString(), shop, op: name, known: !!fn, variables: q.variables || {} });
      try {
        return send(200, { data: fn ? fn(q.variables || {}) : {}, extensions: { cost: { requestedQueryCost: 1 } } });
      } catch (e) {
        return send(200, { errors: [{ message: String(e?.message || e) }] });
      }
    });
  });
  return { server, calls, drafts, orders };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOCK_SHOPIFY_PORT || 3103);
  createMockShopify().server.listen(port, "127.0.0.1", () => console.log(`mock Shopify Admin on ${port}`));
}
