import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  CATALOG_SHARE_ENABLED,
  getPublicCatalogView,
  createLead,
} from "../services/public-catalog.server";
import { HONEYPOT_FIELD } from "../lib/public-catalog";

/**
 * F19 — the public, SEO-friendly wholesale catalog page (/catalog/:shop/:slug).
 * Non-embedded, brand-styled. Reads products through F11 visibility (hidden SKUs
 * never leak) and shows prices only when the merchant chose "Public". The
 * "Request wholesale access" form is honeypot + rate-limited and creates a lead.
 */

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data || !data.view) return [{ title: "Wholesale catalog" }];
  return [
    { title: data.view.meta.title },
    { name: "description", content: data.view.meta.description },
  ];
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  if (!CATALOG_SHARE_ENABLED()) throw new Response("Not found", { status: 404 });
  const shop = params.shop!;
  const slug = params.slug!;
  const view = await getPublicCatalogView(shop, slug);
  if (!view) throw new Response("Catalog not found", { status: 404 });
  return { shop, slug, view };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (!CATALOG_SHARE_ENABLED()) throw new Response("Not found", { status: 404 });
  const shop = params.shop!;
  const slug = params.slug!;
  const body = await request.formData();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  const result = await createLead(shop, slug, {
    email: body.get("email"),
    companyName: body.get("companyName"),
    message: body.get("message"),
    honeypot: body.get(HONEYPOT_FIELD),
    rateKey: `${shop}:${slug}:${ip}`,
    baseUrl,
  });
  return result;
};

export default function PublicCatalog() {
  const { view } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const done = actionData && "ok" in actionData && actionData.ok;
  const error = actionData && "ok" in actionData && !actionData.ok ? actionData.error : null;

  const wrap: React.CSSProperties = {
    maxWidth: "56rem",
    margin: "0 auto",
    padding: "2.5rem 1.25rem 4rem",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#1a1a2e",
    lineHeight: 1.5,
  };
  const input: React.CSSProperties = {
    padding: "0.7rem 0.85rem",
    fontSize: "1rem",
    border: "1px solid #d9d6e5",
    borderRadius: "0.6rem",
    fontFamily: "inherit",
    width: "100%",
  };

  return (
    <main style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <svg width="30" height="30" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M9 28.5V12.5l9.5 9 9.5-9v16" fill="none" stroke="#4F46E5" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="32" cy="25.5" r="3" fill="#A3E635" />
        </svg>
        <span style={{ fontSize: "0.85rem", color: "#5b5670" }}>Wholesale · {view.shopDomain}</span>
      </div>
      <h1 style={{ fontSize: "2rem", margin: "0 0 0.35rem", letterSpacing: "-0.02em" }}>{view.title}</h1>

      {view.priceNotice && (
        <p
          style={{
            background: "#eef0ff",
            border: "1px solid #d7dbff",
            color: "#2f2b6b",
            borderRadius: "0.7rem",
            padding: "0.7rem 0.9rem",
            fontSize: "0.9rem",
            margin: "0.75rem 0 1.5rem",
          }}
        >
          {view.priceNotice}
        </p>
      )}

      <section aria-label="Products" style={{ marginBottom: "2.5rem" }}>
        {view.products.length === 0 ? (
          <p style={{ color: "#5b5670" }}>Products are being added to this catalog. Request access to be notified.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.6rem" }}>
            {view.products.map((p) => (
              <li
                key={p.variantId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "1rem",
                  padding: "0.75rem 0.9rem",
                  border: "1px solid #ece9f5",
                  borderRadius: "0.7rem",
                }}
              >
                <span>
                  <strong style={{ fontWeight: 600 }}>{p.title}</strong>
                  {p.sku && <span style={{ color: "#8a86a0" }}> · {p.sku}</span>}
                  {p.moq != null && (
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", background: "#f0f7d6", color: "#3a4a12", padding: "0.1rem 0.45rem", borderRadius: "999px" }}>
                      MOQ {p.moq}
                    </span>
                  )}
                </span>
                <span style={{ whiteSpace: "nowrap", color: "#1a1a2e" }}>
                  {p.price != null ? `${p.currency} ${p.price}` : <span style={{ color: "#8a86a0" }}>Price on approval</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label="Request wholesale access"
        style={{ background: "#faf9ff", border: "1px solid #e7e3f5", borderRadius: "1rem", padding: "1.5rem" }}
      >
        <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.35rem" }}>Request wholesale access</h2>
        {done ? (
          <div style={{ background: "#f0f7d6", border: "1px solid #dbe9a8", borderRadius: "0.8rem", padding: "1.1rem", color: "#3a4a12" }}>
            <strong>Request sent.</strong> {view.shopDomain} will review it and email you a secure link once you’re approved.
          </div>
        ) : (
          <>
            <p style={{ color: "#5b5670", marginTop: 0 }}>
              Tell us about your business. We review each request and email you a secure link — no password needed.
            </p>
            {error && <p style={{ color: "#8a1f11" }} role="alert">{error}</p>}
            <Form method="post">
              {/* Honeypot — hidden from humans, tempting to bots. */}
              <input
                type="text"
                name={HONEYPOT_FIELD}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
              />
              <div style={{ display: "grid", gap: "0.75rem", maxWidth: "26rem" }}>
                <label style={{ display: "grid", gap: "0.3rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Work email *</span>
                  <input type="email" name="email" required style={input} />
                </label>
                <label style={{ display: "grid", gap: "0.3rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Company name</span>
                  <input type="text" name="companyName" style={input} />
                </label>
                <label style={{ display: "grid", gap: "0.3rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Anything we should know?</span>
                  <textarea name="message" rows={3} style={{ ...input, fontFamily: "inherit" }} />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  style={{ justifySelf: "start", background: "#4f46e5", color: "#fff", border: "none", borderRadius: "0.6rem", padding: "0.8rem 1.4rem", fontSize: "1rem", fontWeight: 700, cursor: "pointer" }}
                >
                  {busy ? "Sending…" : "Request access"}
                </button>
              </div>
            </Form>
          </>
        )}
      </section>
    </main>
  );
}
