# Pre-submission QA, 2026-11-01

Evidence gathered the qa-tester way (oh-my-claudecode): a real production build in a tmux
session, every case with the command sent, the expectation, the captured output and a
verdict, cleanup at the end. Three layers ran against the same commit:

| Layer | Result |
|---|---|
| Vitest unit + integration, with Postgres (migrations applied, none skipped) | 768 passed / 768 |
| e2e browser suite (tests/*.e2e.ts, Chromium, served build) | 13 passed / 13 |
| QA harness (scripts/qa-smoke.sh, 77 HTTP cases below) | 77 passed / 77, 0 server-side errors |

Defects the harness found on its first pass, all fixed in the same change:

- GET on a webhook route answered `400 {"message":"Unexpected Server Error"}` (Remix with
  no loader). Every webhook route now answers non-POST with a plain 405.
- An unknown shop got `enabled: true` from the offer config after the 5.1.2 change. It is
  `false` again for shops that are not installed; installed shops render on every plan.
- Unknown URLs showed "Something went wrong". The root boundary now says "Page not found"
  for a 404, with a link home.

What this run cannot reach from the container, and the manual step that covers each
(numbers are the reviewer steps in SUBMISSION-KIT.md):

- Install and OAuth on a real store, the embedded admin pages and left nav -> step 1.
- Quote -> Draft with Claude -> send -> accept -> Shopify draft order -> steps 2-6.
- Pricing plans -> Choose plan on Shopify's hosted page -> step 10 (review 1.2.2).
- Theme editor: each app block visible after adding it, live and in the editor -> step 11
  (review 5.1.2). Source-level contract pinned by app/lib/theme-blocks.test.ts.
- Public demo on manosh.fly.dev: countered quote, reorder card, draft order -> steps 12-14.
- Customer-account "Your quotes" block on the dev store (verified by hand 2026-09-19).

---

## QA Test Report: Mannon pre-submission (App Store 1.x–5.x behaviours)

### Environment
- Session: `qa-mannon-server-20261101-111605`
- Service: production build (remix-serve) at http://127.0.0.1:3100, Postgres at postgresql://postgres:postgres@localhost:5433/mannon_test
- Date: 2026-11-01T11:16Z · commit 76ed1a3

### Test Cases
### A. Public pages (2.1.1 no web errors, 4.x listing links)
#### TC1: Landing page renders the pitch
- **Command**: `curl http://127.0.0.1:3100/`
- **Expected**: status /200/, body matches /Wholesale quoting/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

#### TC2: Landing: ?shop= hands off to the embedded app (install path)
- **Command**: `curl -i http://127.0.0.1:3100/?shop=example.myshopify.com`
- **Expected**: status /30[1278]/, body matches /location: */app\?shop=/
- **Actual**: status 302 · HTTP/1.1 302 Found location: /app?shop=example.myshopify.com Date: Sun, 01 Nov 2026 11:16:07 GMT Connection: keep-alive Keep-Alive: timeout=5 Transfer-Enco…
- **Status**: PASS

#### TC3: Embedded /app with a shop: OAuth redirect or App Bridge bounce (410), never 5xx
- **Command**: `curl -i http://127.0.0.1:3100/app?shop=example.myshopify.com`
- **Expected**: status /30[1278]|40[01]|410/
- **Actual**: status 410 · HTTP/1.1 410 Gone content-security-policy: frame-ancestors https://example.myshopify.com https://admin.shopify.com https://*.spin.dev https://admin.myshopify.i…
- **Status**: PASS

#### TC4: Embedded /app without a shop fails closed (no 5xx)
- **Command**: `curl -i http://127.0.0.1:3100/app`
- **Expected**: status /30[1278]|40[01]|410/
- **Actual**: status 410 · HTTP/1.1 410 Gone content-type: text/html; charset=utf-8 Vary: Accept-Encoding Date: Sun, 01 Nov 2026 11:16:07 GMT Connection: keep-alive Keep-Alive: timeo…
- **Status**: PASS

#### TC5: Login form at /auth/login
- **Command**: `curl http://127.0.0.1:3100/auth/login`
- **Expected**: status /200/, body matches /Log in|shop/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

#### TC6: Privacy policy served
- **Command**: `curl http://127.0.0.1:3100/privacy`
- **Expected**: status /200/, body matches /Privacy Policy/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

#### TC7: Health probe: value-free config signal
- **Command**: `curl http://127.0.0.1:3100/healthz`
- **Expected**: status /200|503/, body matches /"configOk"/, never /SHOPIFY_|DATABASE_URL/
- **Actual**: status 200 · {"status":"ok","live":true,"configOk":true,"requiredIssues":0}…
- **Status**: PASS

#### TC8: Unknown route → friendly 404 page, not a stack trace
- **Command**: `curl http://127.0.0.1:3100/this-route-does-not-exist`
- **Expected**: status /404/, body matches /Page not found|page you/, never /TypeError|ReferenceError|Something went wrong/
- **Actual**: status 404 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Page not found<!-- --> …
- **Status**: PASS

#### TC9: POST to a page route → 405/404, not 5xx
- **Command**: `curl -X POST http://127.0.0.1:3100/privacy`
- **Expected**: status /40[45]/
- **Actual**: status 405 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Something went wrong<!-- …
- **Status**: PASS

#### TC10: Demo hub
- **Command**: `curl http://127.0.0.1:3100/demo`
- **Expected**: status /200/, body matches /See the whole workflow/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

#### TC11: Merchant tour
- **Command**: `curl http://127.0.0.1:3100/demo/tour`
- **Expected**: status /200/, body matches /tour-step/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

#### TC12: Buyer demo fails closed without a demo store
- **Command**: `curl http://127.0.0.1:3100/demo/buyer`
- **Expected**: status /200/, body matches /isn’t available|isn't available|Welcome, Demo buyer/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

#### TC13: Public pricing page
- **Command**: `curl http://127.0.0.1:3100/pricing`
- **Expected**: status /200|404/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

### B. Buyer & rep portals (passwordless, fail closed)
#### TC14: Portal home without a session → sign-in, never a 5xx
- **Command**: `curl -i http://127.0.0.1:3100/portal`
- **Expected**: status /200|30[1278]/
- **Actual**: status 302 · HTTP/1.1 302 Found location: /portal/signin Date: Sun, 01 Nov 2026 11:16:07 GMT Connection: keep-alive Keep-Alive: timeout=5 Transfer-Encoding: chunked  …
- **Status**: PASS

#### TC15: Magic link with a bad token → plain-language page
- **Command**: `curl http://127.0.0.1:3100/portal/auth?token=not-a-real-token`
- **Expected**: status /200|40[01]/, body matches /expired|invalid|sign in|link/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

#### TC16: POST bad magic token → not consumed, no 5xx
- **Command**: `curl -i -X POST -d token=not-a-real-token http://127.0.0.1:3100/portal/auth`
- **Expected**: status /200|30[1278]|40[01]/
- **Actual**: status 302 · HTTP/1.1 302 Found location: /portal/auth?token=not-a-real-token Date: Sun, 01 Nov 2026 11:16:07 GMT Connection: keep-alive Keep-Alive: timeout=5 Transfer-…
- **Status**: PASS

#### TC17: Portal quote page without a session
- **Command**: `curl -i http://127.0.0.1:3100/portal/quotes/doesnotexist`
- **Expected**: status /200|30[1278]|40[134]/
- **Actual**: status 302 · HTTP/1.1 302 Found location: /portal/signin Date: Sun, 01 Nov 2026 11:16:07 GMT Connection: keep-alive Keep-Alive: timeout=5 Transfer-Encoding: chunked  …
- **Status**: PASS

#### TC18: Portal reorder without a session
- **Command**: `curl -i http://127.0.0.1:3100/portal/reorder/doesnotexist`
- **Expected**: status /200|30[1278]|40[134]/
- **Actual**: status 302 · HTTP/1.1 302 Found location: /portal/signin Date: Sun, 01 Nov 2026 11:16:07 GMT Connection: keep-alive Keep-Alive: timeout=5 Transfer-Encoding: chunked  …
- **Status**: PASS

#### TC19: Portal PWA manifest
- **Command**: `curl http://127.0.0.1:3100/portal/manifest.webmanifest`
- **Expected**: status /200/, body matches /"name"/
- **Actual**: status 200 · {"name":"Mannon Wholesale — Wholesale","short_name":"Mannon Whole","start_url":"/portal","scope":"/portal/","display":"standalone","background_color":"#1A1A2E…
- **Status**: PASS

#### TC20: Portal service worker
- **Command**: `curl http://127.0.0.1:3100/portal/sw.js`
- **Expected**: status /200/, never /<html/
- **Actual**: status 200 ·  const CACHE = "mannon-portal-v1"; const PRECACHE = ["/portal","/portal/manifest.webmanifest"];  self.addEventListener("install", (e) => {   e.waitUntil(caches.…
- **Status**: PASS

#### TC21: Portal icon
- **Command**: `curl http://127.0.0.1:3100/portal/icon.svg`
- **Expected**: status /200/, body matches /<svg/
- **Actual**: status 200 · <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">   <rect width="512" height="512" rx="112" fill="#1A1A2E"/>   <path d="M1…
- **Status**: PASS

#### TC22: Rep portal without a session
- **Command**: `curl -i http://127.0.0.1:3100/rep`
- **Expected**: status /200|30[1278]|40[13]/
- **Actual**: status 302 · HTTP/1.1 302 Found location: /rep/signin Date: Sun, 01 Nov 2026 11:16:08 GMT Connection: keep-alive Keep-Alive: timeout=5 Transfer-Encoding: chunked  …
- **Status**: PASS

#### TC23: Rep company page without a session
- **Command**: `curl -i http://127.0.0.1:3100/rep/company/doesnotexist`
- **Expected**: status /200|30[1278]|40[134]/
- **Actual**: status 302 · HTTP/1.1 302 Found location: /rep/signin Date: Sun, 01 Nov 2026 11:16:08 GMT Connection: keep-alive Keep-Alive: timeout=5 Transfer-Encoding: chunked  …
- **Status**: PASS

#### TC24: Pay link with a bad token → 404
- **Command**: `curl http://127.0.0.1:3100/pay/not-a-token`
- **Expected**: status /404/
- **Actual**: status 404 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Page not found<!-- --> …
- **Status**: PASS

#### TC25: Shared catalog with a bad slug → 404
- **Command**: `curl http://127.0.0.1:3100/catalog/example.myshopify.com/no-such-catalog`
- **Expected**: status /404/
- **Actual**: status 404 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Page not found<!-- --> …
- **Status**: PASS

#### TC26: Wholesale application for an unknown shop → no 5xx
- **Command**: `curl http://127.0.0.1:3100/apply/example.myshopify.com`
- **Expected**: status /200|404/
- **Actual**: status 200 · <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" type="image/png…
- **Status**: PASS

### C. Mandatory webhooks (HMAC, 401 on bad signature)
#### TC27: customers/data_request unsigned → 401
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: customers/data_request -H x-shopify-shop-domain: example.myshopify.com -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/customers/data_request`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC28: customers/data_request wrong signature → 401
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: customers/data_request -H x-shopify-shop-domain: example.myshopify.com -H x-shopify-hmac-sha256: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/customers/data_request`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC29: customers/data_request signed → 200 (unknown shop handled)
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: customers/data_request -H x-shopify-shop-domain: example.myshopify.com -H x-shopify-hmac-sha256: KP+akkl/U6Nq6KRwaSplBjheUutkNEaRCfCFLcEwjiA= -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/customers/data_request`
- **Expected**: status /200/
- **Actual**: status 200 · …
- **Status**: PASS

#### TC30: customers/redact unsigned → 401
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: customers/redact -H x-shopify-shop-domain: example.myshopify.com -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/customers/redact`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC31: customers/redact wrong signature → 401
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: customers/redact -H x-shopify-shop-domain: example.myshopify.com -H x-shopify-hmac-sha256: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/customers/redact`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC32: customers/redact signed → 200 (unknown shop handled)
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: customers/redact -H x-shopify-shop-domain: example.myshopify.com -H x-shopify-hmac-sha256: KP+akkl/U6Nq6KRwaSplBjheUutkNEaRCfCFLcEwjiA= -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/customers/redact`
- **Expected**: status /200/
- **Actual**: status 200 · …
- **Status**: PASS

#### TC33: shop/redact unsigned → 401
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: shop/redact -H x-shopify-shop-domain: example.myshopify.com -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/shop/redact`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC34: shop/redact wrong signature → 401
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: shop/redact -H x-shopify-shop-domain: example.myshopify.com -H x-shopify-hmac-sha256: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/shop/redact`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC35: shop/redact signed → 200 (unknown shop handled)
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: shop/redact -H x-shopify-shop-domain: example.myshopify.com -H x-shopify-hmac-sha256: KP+akkl/U6Nq6KRwaSplBjheUutkNEaRCfCFLcEwjiA= -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/shop/redact`
- **Expected**: status /200/
- **Actual**: status 200 · …
- **Status**: PASS

#### TC36: app/uninstalled unsigned → 401
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: app/uninstalled -H x-shopify-shop-domain: example.myshopify.com -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/app/uninstalled`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC37: app/uninstalled wrong signature → 401
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: app/uninstalled -H x-shopify-shop-domain: example.myshopify.com -H x-shopify-hmac-sha256: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/app/uninstalled`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC38: app/uninstalled signed → 200 (unknown shop handled)
- **Command**: `curl -X POST -H content-type: application/json -H x-shopify-topic: app/uninstalled -H x-shopify-shop-domain: example.myshopify.com -H x-shopify-hmac-sha256: KP+akkl/U6Nq6KRwaSplBjheUutkNEaRCfCFLcEwjiA= -d {"shop_domain":"example.myshopify.com","orders_requested":[],"customer":{"email":"buyer@example.test"}} http://127.0.0.1:3100/webhooks/app/uninstalled`
- **Expected**: status /200/
- **Actual**: status 200 · …
- **Status**: PASS

#### TC39: Webhook route answers GET with 405
- **Command**: `curl http://127.0.0.1:3100/webhooks/shop/redact`
- **Expected**: status /405/, never /Unexpected Server Error/
- **Actual**: status 405 · Method not allowed…
- **Status**: PASS

#### TC40: app/scopes_update unsigned → 401
- **Command**: `curl -X POST -H content-type: application/json -d {} http://127.0.0.1:3100/webhooks/app/scopes_update`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

### D. Storefront endpoints (theme app extension, cross-origin)
#### TC41: OPTIONS /api/quote-request preflight → 204 + CORS
- **Command**: `curl -i -X OPTIONS -H origin: https://example.myshopify.com -H access-control-request-method: POST -H access-control-request-headers: content-type http://127.0.0.1:3100/api/quote-request`
- **Expected**: status /204/, body matches /access-control-allow-origin: \*/
- **Actual**: status 204 · HTTP/1.1 204 No Content access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * Date: Sun, 01 …
- **Status**: PASS

#### TC42: POST /api/quote-request empty body → 400 JSON + CORS
- **Command**: `curl -i -X POST -H content-type: application/json -d {} http://127.0.0.1:3100/api/quote-request`
- **Expected**: status /400/, body matches /"ok":false/
- **Actual**: status 400 · HTTP/1.1 400 Bad Request access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * content-type:…
- **Status**: PASS

#### TC43: POST /api/quote-request malformed JSON → 400, no 5xx
- **Command**: `curl -i -X POST -H content-type: application/json -d not json http://127.0.0.1:3100/api/quote-request`
- **Expected**: status /400/, body matches /"ok":false/
- **Actual**: status 400 · HTTP/1.1 400 Bad Request access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * content-type:…
- **Status**: PASS

#### TC44: GET /api/quote-request → CORS-bearing 405
- **Command**: `curl -i http://127.0.0.1:3100/api/quote-request`
- **Expected**: status /405/, body matches /access-control-allow-origin/
- **Actual**: status 405 · HTTP/1.1 405 Method Not Allowed access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * conten…
- **Status**: PASS

#### TC45: OPTIONS /api/offer preflight → 204 + CORS
- **Command**: `curl -i -X OPTIONS -H origin: https://example.myshopify.com -H access-control-request-method: POST -H access-control-request-headers: content-type http://127.0.0.1:3100/api/offer`
- **Expected**: status /204/, body matches /access-control-allow-origin: \*/
- **Actual**: status 204 · HTTP/1.1 204 No Content access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * Date: Sun, 01 …
- **Status**: PASS

#### TC46: POST /api/offer empty body → 400 JSON + CORS
- **Command**: `curl -i -X POST -H content-type: application/json -d {} http://127.0.0.1:3100/api/offer`
- **Expected**: status /400/, body matches /"ok":false/
- **Actual**: status 400 · HTTP/1.1 400 Bad Request access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * content-type:…
- **Status**: PASS

#### TC47: POST /api/offer malformed JSON → 400, no 5xx
- **Command**: `curl -i -X POST -H content-type: application/json -d not json http://127.0.0.1:3100/api/offer`
- **Expected**: status /400/, body matches /"ok":false/
- **Actual**: status 400 · HTTP/1.1 400 Bad Request access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * content-type:…
- **Status**: PASS

#### TC48: GET /api/offer → CORS-bearing 405
- **Command**: `curl -i http://127.0.0.1:3100/api/offer`
- **Expected**: status /405/, body matches /access-control-allow-origin/
- **Actual**: status 405 · HTTP/1.1 405 Method Not Allowed access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * conten…
- **Status**: PASS

#### TC49: POST quote-request for an unknown shop → graceful JSON
- **Command**: `curl -i -X POST -H content-type: application/json -d {"shop":"example.myshopify.com","email":"buyer@example.test","name":"QA","lines":[{"variantId":"gid://shopify/ProductVariant/1","quantity":2}],"renderedAt":0} http://127.0.0.1:3100/api/quote-request`
- **Expected**: status /200|400/, body matches /"ok"/
- **Actual**: status 400 · HTTP/1.1 400 Bad Request access-control-allow-headers: Content-Type access-control-allow-methods: POST, OPTIONS access-control-allow-origin: * content-type:…
- **Status**: PASS

#### TC50: GET /api/quote-widget-config unknown shop → {enabled:false} + CORS
- **Command**: `curl -i http://127.0.0.1:3100/api/quote-widget-config?shop=example.myshopify.com`
- **Expected**: status /200/, body matches /"enabled":false/
- **Actual**: status 200 · HTTP/1.1 200 OK access-control-allow-headers: Content-Type access-control-allow-methods: GET, OPTIONS access-control-allow-origin: * cache-control: public, …
- **Status**: PASS

#### TC51: GET /api/quote-widget-config without shop → {enabled:false}
- **Command**: `curl http://127.0.0.1:3100/api/quote-widget-config`
- **Expected**: status /200/, body matches /"enabled":false/
- **Actual**: status 200 · {"enabled":false}…
- **Status**: PASS

#### TC52: OPTIONS /api/quote-widget-config → 204
- **Command**: `curl -i -X OPTIONS http://127.0.0.1:3100/api/quote-widget-config`
- **Expected**: status /204|200/
- **Actual**: status 200 · HTTP/1.1 200 OK access-control-allow-headers: Content-Type access-control-allow-methods: GET, OPTIONS access-control-allow-origin: * cache-control: public, …
- **Status**: PASS

#### TC53: GET /api/quote-capture-config unknown shop → {enabled:false} + CORS
- **Command**: `curl -i http://127.0.0.1:3100/api/quote-capture-config?shop=example.myshopify.com`
- **Expected**: status /200/, body matches /"enabled":false/
- **Actual**: status 200 · HTTP/1.1 200 OK access-control-allow-headers: Content-Type access-control-allow-methods: GET, OPTIONS access-control-allow-origin: * cache-control: public, …
- **Status**: PASS

#### TC54: GET /api/quote-capture-config without shop → {enabled:false}
- **Command**: `curl http://127.0.0.1:3100/api/quote-capture-config`
- **Expected**: status /200/, body matches /"enabled":false/
- **Actual**: status 200 · {"enabled":false}…
- **Status**: PASS

#### TC55: OPTIONS /api/quote-capture-config → 204
- **Command**: `curl -i -X OPTIONS http://127.0.0.1:3100/api/quote-capture-config`
- **Expected**: status /204|200/
- **Actual**: status 204 · HTTP/1.1 204 No Content access-control-allow-headers: Content-Type access-control-allow-methods: GET, OPTIONS access-control-allow-origin: * cache-control: …
- **Status**: PASS

#### TC56: GET /api/offer-config unknown shop → {enabled:false} + CORS
- **Command**: `curl -i http://127.0.0.1:3100/api/offer-config?shop=example.myshopify.com`
- **Expected**: status /200/, body matches /"enabled":false/
- **Actual**: status 200 · HTTP/1.1 200 OK access-control-allow-headers: Content-Type access-control-allow-methods: GET, OPTIONS access-control-allow-origin: * cache-control: public, …
- **Status**: PASS

#### TC57: GET /api/offer-config without shop → {enabled:false}
- **Command**: `curl http://127.0.0.1:3100/api/offer-config`
- **Expected**: status /200/, body matches /"enabled":false/
- **Actual**: status 200 · {"enabled":false}…
- **Status**: PASS

#### TC58: OPTIONS /api/offer-config → 204
- **Command**: `curl -i -X OPTIONS http://127.0.0.1:3100/api/offer-config`
- **Expected**: status /204|200/
- **Actual**: status 204 · HTTP/1.1 204 No Content access-control-allow-headers: Content-Type access-control-allow-methods: GET, OPTIONS access-control-allow-origin: * cache-control: …
- **Status**: PASS

#### TC59: GET /api/price-visibility unknown shop → nothing hidden + CORS
- **Command**: `curl -i http://127.0.0.1:3100/api/price-visibility?shop=example.myshopify.com&loggedIn=0`
- **Expected**: status /200/, body matches /access-control-allow-origin/, never /"hidePrice":true/
- **Actual**: status 200 · HTTP/1.1 200 OK access-control-allow-headers: Content-Type access-control-allow-methods: GET, OPTIONS access-control-allow-origin: * cache-control: private,…
- **Status**: PASS

#### TC60: GET /api/quote-form unknown shop → JSON, no 5xx
- **Command**: `curl -i http://127.0.0.1:3100/api/quote-form?shop=example.myshopify.com&surface=PRODUCT`
- **Expected**: status /200|404/
- **Actual**: status 200 · HTTP/1.1 200 OK access-control-allow-headers: Content-Type access-control-allow-methods: GET, OPTIONS access-control-allow-origin: * cache-control: public, …
- **Status**: PASS

#### TC61: Customer-account quotes without a token fails closed
- **Command**: `curl -i http://127.0.0.1:3100/api/account/quotes`
- **Expected**: status /401|410|200/
- **Actual**: status 410 · HTTP/1.1 410 Gone x-remix-catch: yes Date: Sun, 01 Nov 2026 11:16:08 GMT Connection: keep-alive Keep-Alive: timeout=5 Transfer-Encoding: chunked  …
- **Status**: PASS

### E. Internal endpoints (shared secrets, never open)
#### TC62: Cron without secret → 401
- **Command**: `curl -X POST http://127.0.0.1:3100/internal/cron/reminders`
- **Expected**: status /401/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC63: Cron with the secret → 200 JSON
- **Command**: `curl -X POST -H x-cron-secret: qa-cron-secret-0123456789 http://127.0.0.1:3100/internal/cron/reminders`
- **Expected**: status /200/
- **Actual**: status 200 · {"ok":true,"ranAt":"2026-11-01T11:16:09.004Z","results":[{"shop":"dup.myshopify.com","skipped":"not-growth"}]}…
- **Status**: PASS

#### TC64: Cron followups without secret → 401/503/skip, never runs
- **Command**: `curl -X POST http://127.0.0.1:3100/internal/cron/followups`
- **Expected**: status /401|503|200/, never /"sent":[1-9]/
- **Actual**: status 200 · {"ok":true,"skipped":"feature-off"}…
- **Status**: PASS

#### TC65: Cron analytics without secret → 401/503/skip, never runs
- **Command**: `curl -X POST http://127.0.0.1:3100/internal/cron/analytics`
- **Expected**: status /401|503|200/, never /"sent":[1-9]/
- **Actual**: status 200 · {"ok":true,"skipped":"feature-off"}…
- **Status**: PASS

#### TC66: Cron accounting without secret → 401/503/skip, never runs
- **Command**: `curl -X POST http://127.0.0.1:3100/internal/cron/accounting`
- **Expected**: status /401|503|200/, never /"sent":[1-9]/
- **Actual**: status 200 · {"ok":true,"skipped":"feature-off"}…
- **Status**: PASS

#### TC67: Cron erp without secret → 401/503/skip, never runs
- **Command**: `curl -X POST http://127.0.0.1:3100/internal/cron/erp`
- **Expected**: status /401|503|200/, never /"sent":[1-9]/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC68: Cron reorder-push without secret → 401/503/skip, never runs
- **Command**: `curl -X POST http://127.0.0.1:3100/internal/cron/reorder-push`
- **Expected**: status /401|503|200/, never /"sent":[1-9]/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC69: Cron tax-reminders without secret → 401/503/skip, never runs
- **Command**: `curl -X POST http://127.0.0.1:3100/internal/cron/tax-reminders`
- **Expected**: status /401|503|200/, never /"sent":[1-9]/
- **Actual**: status 200 · {"ok":true,"skipped":"feature-off"}…
- **Status**: PASS

#### TC70: Cron payment-reminders without secret → 401/503/skip, never runs
- **Command**: `curl -X POST http://127.0.0.1:3100/internal/cron/payment-reminders`
- **Expected**: status /401|503|200/, never /"sent":[1-9]/
- **Actual**: status 401 · Unauthorized…
- **Status**: PASS

#### TC71: ERP stock without secret → 400/401
- **Command**: `curl -X POST -H content-type: application/json -d {} http://127.0.0.1:3100/internal/erp/stock`
- **Expected**: status /40[01]/
- **Actual**: status 400 · Missing shop/secret…
- **Status**: PASS

#### TC72: ERP stock GET → 405
- **Command**: `curl http://127.0.0.1:3100/internal/erp/stock`
- **Expected**: status /405/
- **Actual**: status 405 · Method not allowed…
- **Status**: PASS

#### TC73: Debug config route requires admin auth
- **Command**: `curl -i http://127.0.0.1:3100/app/debug/config`
- **Expected**: status /30[1278]|40[01]|410/, never /SHOPIFY_API_SECRET/
- **Actual**: status 410 · HTTP/1.1 410 Gone content-type: text/html; charset=utf-8 Vary: Accept-Encoding Date: Sun, 01 Nov 2026 11:16:09 GMT Connection: keep-alive Keep-Alive: timeo…
- **Status**: PASS

### F. Security headers & hygiene
#### TC74: Landing has no server-version banner
- **Command**: `curl -i http://127.0.0.1:3100/`
- **Expected**: status /200/, never /x-powered-by: express/
- **Actual**: status 200 · HTTP/1.1 200 OK content-type: text/html; charset=utf-8 Vary: Accept-Encoding Date: Sun, 01 Nov 2026 11:16:09 GMT Connection: keep-alive Keep-Alive: timeout…
- **Status**: PASS

#### TC75: Embedded shell is not framed from an arbitrary origin without a shop
- **Command**: `curl -i -H sec-fetch-dest: iframe http://127.0.0.1:3100/app`
- **Expected**: status /30[1278]|40[01]|410/
- **Actual**: status 410 · HTTP/1.1 410 Gone content-type: text/html; charset=utf-8 Vary: Accept-Encoding Date: Sun, 01 Nov 2026 11:16:09 GMT Connection: keep-alive Keep-Alive: timeo…
- **Status**: PASS

#### TC76: Secrets never echo back (healthz)
- **Command**: `curl http://127.0.0.1:3100/healthz`
- **Expected**: status /200|503/, never /qa-dummy|qa-session/
- **Actual**: status 200 · {"status":"ok","live":true,"configOk":true,"requiredIssues":0}…
- **Status**: PASS

#### TC77: Huge body to the offer endpoint is refused cleanly
- **Command**: `curl -X POST -H content-type: application/json --data-binary @/tmp/claude-0/-home-user/07093f4e-3fc4-5b8a-8591-7fc0e9a4ba90/scratchpad/qa-20261101-111605/big.json http://127.0.0.1:3100/api/offer`
- **Expected**: status /400|413/
- **Actual**: status 400 · {"ok":false,"error":"Invalid request."}…
- **Status**: PASS


### Summary
- Total: 77 tests
- Passed: 77
- Failed: 0
- Server-side error lines during the run: 0 (see server.log)

### Cleanup
- Session killed: YES (qa-mannon-server-20261101-111605)
- Server log kept at: /tmp/claude-0/-home-user/07093f4e-3fc4-5b8a-8591-7fc0e9a4ba90/scratchpad/qa-20261101-111605/server.log
