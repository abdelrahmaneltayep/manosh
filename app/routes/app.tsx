import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { navFlags } from "../lib/nav";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Session-token auth (BFS §3.1): every embedded route authenticates here (this
  // shell) and again in its own loader/action. No cookie-only admin routes.
  await authenticate.admin(request);

  // Only link to ENABLED features. A flag-gated route 404s when off, and linking
  // to it makes the embedded app throw "Something went wrong" on tab click
  // (App Store review 2.1.1). Core routes below have no flag and always show.
  return { apiKey: process.env.SHOPIFY_API_KEY || "", nav: navFlags(process.env) };
};

// Embedded admin shell. The nav grows as later slices land their routes
// (S6 Quotes, S13 dashboard becomes Home, settings, etc.). Kept to Home only
// for S1 so there are no dead links in the nav.
export default function App() {
  const { apiKey, nav } = useLoaderData<typeof loader>();

  // App Bridge (BFS §3.1): AppProvider loads App Bridge from the UNVERSIONED CDN
  // (`https://cdn.shopify.com/shopifycloud/app-bridge.js`, per
  // @shopify/shopify-app-remix APP_BRIDGE_URL) — latest, not bundled, not pinned.
  // This is the Shopify-sanctioned embedded setup; we don't hand-roll the script
  // tag (which would double-load and risk the live embedded frame).
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/quotes">Quotes</Link>
        {nav.quoteRequests && <Link to="/app/quote-requests">Requests</Link>}
        {nav.quoteForms && <Link to="/app/quote-forms">Quote forms</Link>}
        {nav.priceRules && <Link to="/app/price-rules">Price rules</Link>}
        {nav.offers && <Link to="/app/offers">Offers</Link>}
        {nav.followups && <Link to="/app/followups">Follow-ups</Link>}
        {nav.analytics && <Link to="/app/analytics">Analytics</Link>}
        <Link to="/app/buyers">Buyers</Link>
        {nav.reps && <Link to="/app/reps">Reps</Link>}
        {nav.wholesale && <Link to="/app/wholesale">Wholesale</Link>}
        {nav.priceLists && <Link to="/app/price-lists">Price lists</Link>}
        {nav.catalogs && <Link to="/app/catalogs">Catalogs</Link>}
        {nav.catalogSharing && <Link to="/app/catalog-sharing">Catalog sharing</Link>}
        {nav.orderRules && <Link to="/app/order-rules">Order rules</Link>}
        {nav.credit && <Link to="/app/credit">Credit</Link>}
        {nav.payments && <Link to="/app/payments">Payments</Link>}
        {nav.tax && <Link to="/app/tax">Tax &amp; VAT</Link>}
        {nav.i18n && <Link to="/app/i18n">Languages</Link>}
        {nav.erp && <Link to="/app/erp">ERP sync</Link>}
        {nav.accounting && <Link to="/app/accounting">Accounting</Link>}
        {nav.agency && <Link to="/app/agency">Agency</Link>}
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses so their headers are
// included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
