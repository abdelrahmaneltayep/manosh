import type { MetaFunction } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
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
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        {/* Mannon brand type: Outfit for headings/wordmark, Inter for body.
            Used by the marketing landing page and the buyer portal; the
            embedded Polaris admin keeps Shopify's own font stack. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
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
export function ErrorBoundary() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Something went wrong — Mannon</title>
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
          <h1 style={{ fontSize: "1.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#4a4a4a" }}>
            We hit an unexpected problem. Please refresh the page and try again.
          </p>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
