# Built-for-Shopify — Integration audit (§3.1, PR-2)

BFS is auto-evaluated by Shopify. This documents the Integration bars and where
each is met in the codebase. (Traction — 50 paid installs + 5 reviews + ~4★ — is
GTM, not code.)

## App Bridge — latest, from the CDN

- Loaded from the **unversioned CDN** `https://cdn.shopify.com/shopifycloud/app-bridge.js`
  via `@shopify/shopify-app-remix`'s `AppProvider` (`app/routes/app.tsx`, which sets
  `isEmbeddedApp` and renders `<script src={APP_BRIDGE_URL} data-api-key>`). Latest,
  not bundled, not version-pinned.
- We deliberately do **not** hand-add a second script tag to `root.tsx` `<head>`:
  the AppProvider already injects the sanctioned one, and a duplicate would risk
  double-initializing the embedded frame (the app is live / in review). `root.tsx`
  keeps the `preconnect` to `cdn.shopify.com`.

## Session-token auth on every admin route

- **Every `app.*` route authenticates** via `authenticate.admin(request)` (the
  `app.tsx` shell + each route's own loader/action). Audit: no `app.*`
  loader/action is cookie-only. Re-run the audit with:
  ```sh
  for f in app/routes/app.*.tsx; do grep -qE "export (const|async function) (loader|action)" "$f" \
    && ! grep -q "authenticate.admin\|requirePlan\|requireBilling" "$f" && echo "UNGATED: $f"; done
  ```
- Non-admin surfaces are intentionally public and protected differently: webhooks
  use HMAC (`authenticate`/`verifyWebhook`), the storefront widget API (F17) is
  CORS + honeypot + rate-limit + escaping, and the **magic-link buyer portal** is an
  external buyer surface (its own signed session), not a merchant admin workflow.

## GDPR + lifecycle webhooks

All four are declared in `shopify.app.toml` and handled with **HMAC verification**
(`verifyWebhook`) — bad/missing signature → **401** before any handler logic:

| Topic | Route | Handler |
|---|---|---|
| `app/uninstalled` | `webhooks.app.uninstalled.tsx` | `cleanupUninstall` |
| `app/scopes_update` | `webhooks.app.scopes_update.tsx` | — |
| `customers/data_request` | `webhooks.customers.data_request.tsx` | `collectCustomerData` |
| `customers/redact` | `webhooks.customers.redact.tsx` | `redactCustomer` |
| `shop/redact` | `webhooks.shop.redact.tsx` | `redactShop` |

**On uninstall** (`cleanupUninstall`, §3.1): (1) **revoke tokens** — delete the
shop's sessions (they hold the access tokens); (2) **deactivate theme-app-extension
config** — turn off the F17 widget so a reinstall starts clean and nothing renders
on the storefront until re-enabled. Full data erasure follows ~48h later via
`shop/redact`.

**Tests:** `app/routes/webhooks.test.ts` asserts missing-signature and
wrong-signature → 401 for all four, plus signed-payload behavior; `gdpr.server.test.ts`
covers the redaction cascades and the uninstall token-revoke + extension-deactivate.

## No Asset API — theme app extension only

The storefront surface (F17 Request-a-Quote; F21 Make-an-Offer to come) ships as a
**theme app extension** (`extensions/`), never the Asset API. Audit: no Asset API
calls in `app/` (`grep -rniE "assets(_put|_create)|themes/.*assets" app/` → none).

## Result

App Bridge (CDN latest) ✓ · session-token auth on all admin routes ✓ · 4
GDPR/lifecycle webhooks HMAC-verified + tested ✓ · clean uninstall (tokens +
extension config) ✓ · no Asset API ✓.
