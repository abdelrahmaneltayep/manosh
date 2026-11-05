/*
 * Loaded with `node --import` into the served build during the local QA run
 * only. Sends every request for https://<shop>.myshopify.com to the mock Admin
 * API (MANNON_QA_SHOPIFY_MOCK) and, when MANNON_QA_ANTHROPIC_MOCK is set, every
 * Claude API request to the mock Claude, so the whole app runs without a real
 * store. It must load before the app: the Shopify library keeps a reference to
 * globalThis.fetch when it is imported.
 */
const shopifyMock = process.env.MANNON_QA_SHOPIFY_MOCK;
const claudeMock = process.env.MANNON_QA_ANTHROPIC_MOCK;
const realFetch = globalThis.fetch;

if (shopifyMock) {
  globalThis.fetch = async function mannonQaFetch(input, init) {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let u;
    try { u = new URL(href); } catch { return realFetch(input, init); }
    let target = null;
    const headers = new Headers(init?.headers || (typeof input === "object" && !(input instanceof URL) ? input.headers : undefined));
    if (u.hostname.endsWith(".myshopify.com")) {
      target = `${shopifyMock}${u.pathname}${u.search}`;
      headers.set("x-mannon-shop", u.hostname);
    } else if (claudeMock && u.hostname === "api.anthropic.com") {
      target = `${claudeMock}${u.pathname}${u.search}`;
    }
    if (!target) return realFetch(input, init);
    const method = init?.method || (typeof input === "object" && !(input instanceof URL) ? input.method : "GET");
    let body = init?.body;
    if (body === undefined && typeof input === "object" && !(input instanceof URL) && input.body) body = await input.text();
    return realFetch(target, { method, headers, body });
  };
}
