import type { HeadersFunction, LinksFunction, MetaFunction } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import demoStyles from "../styles/demo.css?url";

/**
 * Public demo shell (Mannon brand). Children: the hub (/demo), the live buyer
 * entry (/demo/buyer) and the guided merchant tour (/demo/tour). Standalone —
 * no Polaris or App Bridge, so it's light and never depends on a Shopify session.
 */

export const links: LinksFunction = () => [{ rel: "stylesheet", href: demoStyles }];

export const meta: MetaFunction = () => [
  { title: "Try Mannon — live buyer demo and merchant tour" },
  {
    name: "description",
    content: "Try Mannon's B2B quote, counter and reorder workflow with no install: a live buyer portal on our demo store, plus a guided tour of the merchant side.",
  },
];

export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
});

export default function DemoLayout() {
  return (
    <div className="demo-shell">
      <div className="demo-blob tr" aria-hidden="true" />
      <div className="demo-blob bl" aria-hidden="true" />
      <header className="demo-head">
        <Link to="/" className="demo-logo" aria-label="Mannon home">
          <span className="demo-mark" aria-hidden="true">M</span>
          <span>mannon</span>
        </Link>
        <nav className="demo-head-links" aria-label="Demo">
          <Link to="/demo">Demo</Link>
          <Link to="/demo/tour">Merchant tour</Link>
          <Link to="/">
            Install on your store <span aria-hidden="true">→</span>
          </Link>
        </nav>
      </header>
      <main className="demo-main">
        <Outlet />
      </main>
    </div>
  );
}
