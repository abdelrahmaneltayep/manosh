import type { HeadersFunction, LinksFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import portalStyles from "../styles/portal.css?url";

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
