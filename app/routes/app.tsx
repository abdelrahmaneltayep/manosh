import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// Embedded admin shell. The nav grows as later slices land their routes
// (S6 Quotes, S13 dashboard becomes Home, settings, etc.). Kept to Home only
// for S1 so there are no dead links in the nav.
export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/quotes">Quotes</Link>
        <Link to="/app/quote-requests">Requests</Link>
        <Link to="/app/quote-forms">Quote forms</Link>
        <Link to="/app/price-rules">Price rules</Link>
        <Link to="/app/followups">Follow-ups</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/buyers">Buyers</Link>
        <Link to="/app/reps">Reps</Link>
        <Link to="/app/wholesale">Wholesale</Link>
        <Link to="/app/price-lists">Price lists</Link>
        <Link to="/app/catalogs">Catalogs</Link>
        <Link to="/app/catalog-sharing">Catalog sharing</Link>
        <Link to="/app/order-rules">Order rules</Link>
        <Link to="/app/credit">Credit</Link>
        <Link to="/app/payments">Payments</Link>
        <Link to="/app/tax">Tax &amp; VAT</Link>
        <Link to="/app/i18n">Languages</Link>
        <Link to="/app/erp">ERP sync</Link>
        <Link to="/app/accounting">Accounting</Link>
        <Link to="/app/agency">Agency</Link>
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
