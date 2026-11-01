import type { MetaFunction } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";

// Default document title. Embedded admin pages set their own via App Bridge
// TitleBar; portal pages inherit this unless a route overrides it.
export const meta: MetaFunction = () => [{ title: "Mannon" }];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="icon" type="image/png" href="/favicon-32.png" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Last-resort error boundary. Route-level boundaries (Shopify's admin boundary
// in app.tsx, the buyer-portal boundary in portal.tsx) handle their own
// surfaces; this catches anything above them so a merchant or buyer never sees
// a raw stack trace. It must render a full document because it replaces <App>.
// A 404 gets its own copy: an unknown URL is not "something went wrong".
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const title = notFound ? "Page not found" : "Something went wrong";
  const body = notFound
    ? "The page you're looking for doesn't exist or has moved."
    : "We hit an unexpected problem. Please refresh the page and try again.";
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title} — Mannon</title>
        <Meta />
        <Links />
      </head>
      <body>
        <main
          style={{
            maxWidth: "32rem",
            margin: "4rem auto",
            padding: "0 1rem",
            fontFamily:
              "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            lineHeight: 1.5,
          }}
        >
          <h1 style={{ fontSize: "1.5rem" }}>{title}</h1>
          <p style={{ color: "#4a4a4a" }}>{body}</p>
          <p>
            <a href="/" style={{ color: "#4338ca" }}>
              Go to the Mannon home page
            </a>
          </p>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
