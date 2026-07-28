import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { requireRepId } from "../services/rep-session.server";
import { getRep, getRepCompany, recordOnBehalf, REP_PORTAL_ENABLED } from "../services/rep.server";
import { getVisibleCatalog } from "../services/catalogs.server";
import { getCompanyPricing } from "../services/price-list.server";
import { resolvePrice } from "../lib/price-resolver";
import { parseQuoteSelections, submitBuyerQuote } from "../services/portal-quote.server";
import { impersonationBannerText } from "../lib/rep";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (!REP_PORTAL_ENABLED()) throw new Response("Not found", { status: 404 });
  const repId = await requireRepId(request);
  const companyId = params.companyId!;

  // Strict isolation: getRepCompany returns null unless this company is assigned.
  const company = await getRepCompany(repId, companyId);
  if (!company) throw new Response("Account not found", { status: 404 });

  const url = new URL(request.url);
  const actingBuyerId = url.searchParams.get("as");
  const actingBuyer = actingBuyerId ? company.buyers.find((b) => b.id === actingBuyerId) ?? null : null;

  let items: Array<{ variantId: string; title: string; sku: string | null; currency: string; price: string }> = [];
  let catalogError = false;
  if (actingBuyer) {
    try {
      const catalog = await getVisibleCatalog(company.shop.shopifyDomain, { buyerId: actingBuyer.id, companyId });
      const pricing = await getCompanyPricing(companyId);
      items = catalog.map((it) => {
        const resolved = resolvePrice(1, {
          listPrice: Number(it.price),
          entryPrice: pricing.entriesByVariant.get(it.variantId) ?? null,
          breaks: pricing.breaksByVariant.get(it.variantId) ?? null,
        });
        return { variantId: it.variantId, title: it.displayTitle, sku: it.sku, currency: it.currencyCode, price: resolved.price.toFixed(2) };
      });
    } catch {
      catalogError = true;
    }
  }

  return {
    company: { id: company.id, name: company.name },
    buyers: company.buyers,
    quotes: company.quotes,
    acting: actingBuyer ? { id: actingBuyer.id, label: actingBuyer.name ?? actingBuyer.email } : null,
    banner: actingBuyer ? impersonationBannerText(actingBuyer.name ?? actingBuyer.email, company.name) : null,
    items,
    catalogError,
    placed: url.searchParams.get("placed"),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (!REP_PORTAL_ENABLED()) throw new Response("Not found", { status: 404 });
  const repId = await requireRepId(request);
  const companyId = params.companyId!;
  const rep = await getRep(repId);
  if (!rep) throw redirect("/rep/signin");

  const company = await getRepCompany(repId, companyId);
  if (!company) throw new Response("Account not found", { status: 404 });

  const form = await request.formData();
  const buyerId = String(form.get("buyerId") ?? "");
  const buyer = company.buyers.find((b) => b.id === buyerId);
  if (!buyer) return { error: "Choose a buyer to order on behalf of." };

  const selections = parseQuoteSelections(form);
  if (selections.length === 0) return { error: "Add at least one item." };

  let catalog;
  try {
    catalog = await getVisibleCatalog(company.shop.shopifyDomain, { buyerId: buyer.id, companyId });
  } catch {
    return { error: "We couldn’t load the catalog just now. Please try again." };
  }

  // Order on behalf: the quote is attributed to the rep (placedByRepId) and
  // remains the buyer's. Buyer limits (F9 MOQ, F5 approvals) still apply.
  const result = await submitBuyerQuote({ id: buyer.id, companyId }, selections, catalog, { placedByRepId: repId });
  if (!result.ok) return { error: result.error };

  await recordOnBehalf({
    shopId: company.shopId,
    shopDomain: company.shop.shopifyDomain,
    repId,
    quoteId: result.quote.id,
    buyer: { id: buyer.id, email: buyer.email, name: buyer.name },
    companyName: company.name,
  });

  return redirect(`/rep/company/${companyId}?placed=${result.quote.id}`);
};

export default function RepCompany() {
  const data = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const [, setSearchParams] = useSearchParams();
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  return (
    <section className="portal-card">
      <p><Link to="/rep" className="portal-link">← Your accounts</Link></p>
      <h1>{data.company.name}</h1>

      {data.placed && (
        <p className="save-badge" role="status" style={{ display: "inline-block", marginBottom: "0.5rem" }}>
          Order placed on behalf of the buyer — they’ve been notified.
        </p>
      )}

      {data.banner && (
        <div
          role="status"
          style={{ background: "#4F46E5", color: "#fff", borderRadius: 10, padding: "10px 14px", margin: "0 0 1rem", fontWeight: 700 }}
        >
          {data.banner}{" "}
          <Link to={`/rep/company/${data.company.id}`} style={{ color: "#A3E635", fontWeight: 600 }}>Exit</Link>
        </div>
      )}

      {!data.acting ? (
        <>
          <h2 style={{ fontSize: "1rem" }}>Order on behalf of a buyer</h2>
          <ul className="catalog-list">
            {data.buyers.map((b) => (
              <li key={b.id} className="catalog-row">
                <div className="catalog-info">
                  <span className="catalog-title">{b.name ?? b.email}</span>
                  {b.name && <span className="muted"> · {b.email}</span>}
                </div>
                <button
                  type="button"
                  className="portal-button"
                  onClick={() => setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("as", b.id); return n; })}
                >
                  Order on behalf
                </button>
              </li>
            ))}
          </ul>

          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Recent quotes</h2>
          {data.quotes.length === 0 ? (
            <p className="muted">No quotes yet for this account.</p>
          ) : (
            <ul className="catalog-list">
              {data.quotes.map((q) => (
                <li key={q.id} className="catalog-row">
                  <div className="catalog-info">
                    <Link to={`/portal/quotes/${q.id}`} className="catalog-title">Quote {q.id.slice(-6)}</Link>
                    <span className="muted"> · {q.status}{q.placedByRepId ? " · via rep" : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : data.catalogError ? (
        <p className="error">We couldn’t load the catalog. Please refresh.</p>
      ) : (
        <Form method="post">
          <input type="hidden" name="buyerId" value={data.acting.id} />
          <ul className="catalog-list">
            {data.items.map((it) => (
              <li key={it.variantId} className="catalog-row">
                <div className="catalog-info">
                  <span className="catalog-title">{it.title}</span>
                  {it.sku && <span className="muted"> · {it.sku}</span>}
                  <span className="muted"> · {it.currency} {it.price}</span>
                </div>
                <label className="catalog-qty">
                  <span className="visually-hidden">Quantity for {it.title}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    name={`quantity_${it.variantId}`}
                    value={quantities[it.variantId] ?? ""}
                    onChange={(e) => setQuantities((prev) => ({ ...prev, [it.variantId]: e.target.value }))}
                    placeholder="0"
                  />
                </label>
              </li>
            ))}
          </ul>
          {data.items.length === 0 && <p className="muted">This buyer has no visible products.</p>}
          <button type="submit" className="portal-button" disabled={submitting || data.items.length === 0}>
            {submitting ? "Placing…" : "Place order on behalf"}
          </button>
        </Form>
      )}
    </section>
  );
}
