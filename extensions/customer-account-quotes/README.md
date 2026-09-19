# Mannon — "Your quotes" Customer Account UI extension (F25.5)

Surfaces the buyer's Mannon quotes + reorder **natively** inside Shopify's new
customer account. Read-only; deep-links to the magic-link portal for actions.

Built on **API 2026-07** with **Preact + Polaris web components** (`s-section`,
`s-stack`, `s-text`, `s-badge`, `s-button`, `s-banner`, `s-spinner`). API 2025-07 was
the last version to support the React component set, so this extension no longer
uses `@shopify/ui-extensions-react`.

## How it works

1. The block renders on `customer-account.order-index.block.render` (the account home).
2. It gets the customer-account **session token** via `useSessionToken()` from
   `@shopify/ui-extensions/customer-account/preact`.
3. It calls the Mannon backend `GET {APP_URL}/api/account/quotes` with
   `Authorization: Bearer <token>`. The backend authenticates the token via
   `authenticate.public.customerAccount`, resolves the buyer **from the token's
   subject** (nothing client-supplied is trusted), gates to a paid plan, and returns
   the buyer's quotes + the portal base URL.
4. Each quote shows status + an estimated total, with a **Reorder** (ordered quotes)
   or **Request similar** button that deep-links to the portal.

## Build / verify

The Shopify CLI bundles this extension (it's excluded from the app's root `tsconfig`).

```sh
# type-check against the exact web-component types for this target
cd extensions/customer-account-quotes && npm install && npm run typecheck

# run against the dev store
shopify app dev

# release a new app version that includes the extension
npm run deploy
```

Then, on the dev store's **new customer account** (Settings → Customer accounts →
"New customer accounts"), open a logged-in buyer's account home and confirm the
"Your quotes" block lists their quotes with the right status + buttons.

`APP_URL` in `src/QuotesBlock.tsx` must be the deployed app host. The extension's
`network_access` capability needs approval in the Partner Dashboard before the
fetch is allowed on a live store.
