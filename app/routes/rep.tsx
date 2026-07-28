import type { HeadersFunction, LinksFunction } from "@remix-run/node";
import { Outlet, Link, isRouteErrorResponse, useRouteError } from "@remix-run/react";
import portalStyles from "../styles/portal.css?url";
import { portalErrorContent } from "../lib/portal-error";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: portalStyles }];

// Non-embedded sales-rep portal shell — a scoped "admin-lite" for reps, built on
// the same light (no Polaris/App Bridge) portal shell as the buyer portal.
export const headers: HeadersFunction = () => ({
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
});

export default function RepLayout() {
  return (
    <main className="portal">
      <Outlet />
    </main>
  );
}

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
          <Link to="/rep" className="portal-link">← Back to your accounts</Link>
        </p>
      </section>
    </main>
  );
}
