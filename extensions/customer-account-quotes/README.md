# Mannon — "Your quotes" Customer Account UI extension (F25.5)

Surfaces the buyer's Mannon quotes + reorder **natively** inside Shopify's new
customer account. Read-only; deep-links to the magic-link portal for actions.

## How it works

1. The block renders on `customer-account.order-index.block.render` (the account home).
2. It reads the logged-in buyer (`authenticatedAccount.customer`) and signs a request
   with the customer-account **session token**.
3. It calls the Mannon backend `GET {APP_URL}/api/account/quotes?email=<buyer>` with
   `Authorization: Bearer <token>`. The backend authenticates the token via
   `authenticate.public.customerAccount`, gates to a paid plan (Starter+), and
   returns the buyer's quotes + the portal base URL.
4. Each quote shows status + an estimated total, with a **Reorder** (ordered quotes)
   or **Request similar** button that deep-links to the portal.

## Build / verify (outside the app's Vite pipeline)

This extension builds with the Shopify CLI, not the app's `tsc`/Vite (it's excluded
from the root `tsconfig`). To run it:

```sh
# from the repo root
shopify app dev            # serves the extension against your dev store
```

Then, on the dev store's **new customer account** (Settings → Customer accounts →
"New customer accounts"), open a logged-in buyer's account home and confirm the
"Your quotes" block lists their quotes with the right status + buttons.

Set `APP_URL` in `src/QuotesBlock.tsx` to your deployed app host, and confirm the
exact `@shopify/ui-extensions-react/customer-account` component prop names against
the version the CLI installs.

## Hardening TODO

The backend currently scopes by the `email` query param. Before GA, cross-check that
email against the token's customer identity (the token proves *a* logged-in customer
of the shop; the extra check proves it's *this* buyer's email).
