import type { HeadersFunction, LinksFunction } from "@remix-run/node";
import {
  Outlet,
  Link,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import portalStyles from "../styles/portal.css?url";
import { portalErrorContent } from "../lib/portal-error";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: portalStyles },
];

// Non-embedded buyer portal shell. Deliberately light — no Polaris/App Bridge
// bundle — so it renders fast (p95 < 500ms) and works as a standalone page
// outside Shopify Admin. Later slices (S7 quote builder, S9 reorder,
// S10 quick-order) render inside this shell.

// Standalone surface: forbid framing to prevent clickjacking.
export const headers: HeadersFunction = () => ({
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
});

export default function PortalLayout() {
  return (
    <main className="portal">
      <Outlet />
    </main>
  );
}

// Buyer-portal error boundary. Replaces the layout on any thrown error in a
// portal route (e.g. a 404 "Quote not found"), so a buyer sees friendly,
// plain-language copy instead of a raw stack trace. It re-renders the <main>
// landmark because it stands in for PortalLayout above.
export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const { title, body } = portalErrorContent(status);
  return (
    <main className="portal">
      <section className="portal-card" role="alert" aria-live="assertive">
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        <p>
          <Link to="/portal" className="portal-link">
            ← Back to your portal
          </Link>
        </p>
      </section>
    </main>
  );
}
