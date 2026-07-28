import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { CATALOG_SHARE_ENABLED, listDiscovery } from "../services/public-catalog.server";

/**
 * F19 — the opt-in Mannon discovery index (/discover): a simple public directory
 * of wholesale catalogs whose merchants chose "Listed". Merchants control this —
 * only LISTED + LIVE catalogs appear, and nothing from a private catalog leaks.
 */

export const meta: MetaFunction = () => [
  { title: "Discover wholesale catalogs — Mannon" },
  { name: "description", content: "Browse wholesale catalogs from Shopify brands and request trade access." },
];

export const loader = async (_args: LoaderFunctionArgs) => {
  if (!CATALOG_SHARE_ENABLED()) throw new Response("Not found", { status: 404 });
  const catalogs = await listDiscovery();
  return { catalogs };
};

export default function Discover() {
  const { catalogs } = useLoaderData<typeof loader>();
  const wrap: React.CSSProperties = {
    maxWidth: "56rem",
    margin: "0 auto",
    padding: "2.5rem 1.25rem 4rem",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#1a1a2e",
    lineHeight: 1.5,
  };
  return (
    <main style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <svg width="30" height="30" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M9 28.5V12.5l9.5 9 9.5-9v16" fill="none" stroke="#4F46E5" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="32" cy="25.5" r="3" fill="#A3E635" />
        </svg>
        <strong style={{ fontSize: "1.15rem" }}>Discover wholesale</strong>
      </div>
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.35rem", letterSpacing: "-0.02em" }}>Wholesale catalogs</h1>
      <p style={{ color: "#5b5670", marginTop: 0 }}>Browse catalogs from brands using Mannon and request trade access.</p>

      {catalogs.length === 0 ? (
        <p style={{ color: "#5b5670" }}>No listed catalogs yet. Check back soon.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "1.5rem 0 0", display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))" }}>
          {catalogs.map((c) => (
            <li key={`${c.shopDomain}:${c.slug}`}>
              <Link
                to={`/catalog/${c.shopDomain}/${c.slug}`}
                style={{ display: "block", textDecoration: "none", color: "inherit", border: "1px solid #ece9f5", borderRadius: "0.9rem", padding: "1.1rem" }}
              >
                <strong style={{ display: "block", fontSize: "1.05rem" }}>{c.title}</strong>
                <span style={{ color: "#8a86a0", fontSize: "0.85rem" }}>{c.shopDomain}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
