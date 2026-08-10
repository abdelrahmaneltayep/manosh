import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { navFlags, visibleNavParents } from "../lib/nav";

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
  // Merged IA: 22 flat pages → 7 tabbed parents (NAV-MIGRATION.md). Each parent
  // links to its first ENABLED tab so the nav never points at a 404; the in-page
  // SectionTabs bar switches between the folded pages. Home stays as the required
  // App Bridge rel="home" row.
  const parents = visibleNavParents(nav);
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        {parents.map((p) => (
          <Link key={p.url} to={p.url}>
            {p.label}
          </Link>
        ))}
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
