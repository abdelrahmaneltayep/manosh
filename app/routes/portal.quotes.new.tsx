import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import { type CatalogItem } from "../services/catalog.server";
import { getVisibleCatalog } from "../services/catalogs.server";
import {
  parseQuoteSelections,
  submitBuyerQuote,
} from "../services/portal-quote.server";
import { getCompanyPricing } from "../services/price-list.server";
import { resolvePrice } from "../lib/price-resolver";

const PRICELISTS_ENABLED = () => process.env.MANNON_FF_PRICELISTS === "true";

async function loadBuyer(request: Request) {
  const buyerId = await requireBuyerId(request);
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { company: { include: { shop: true } } },
  });
  if (!buyer) throw redirect("/portal/signin");
  return buyer;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const buyer = await loadBuyer(request);
  let catalog: CatalogItem[] = [];
  let catalogError = false;
  try {
    catalog = await getVisibleCatalog(buyer.company.shop.shopifyDomain, { buyerId: buyer.id, companyId: buyer.companyId });
  } catch {
    catalogError = true;
  }

  // F3 — decorate each item with the buyer's resolved price + "you save X%".
  const pricing = PRICELISTS_ENABLED()
    ? await getCompanyPricing(buyer.companyId)
    : null;
  const items = catalog.map((item) => {
    const listPrice = Number(item.price);
    const breaks = pricing?.breaksByVariant.get(item.variantId) ?? null;
    const resolved = pricing
      ? resolvePrice(1, {
          listPrice,
          entryPrice: pricing.entriesByVariant.get(item.variantId) ?? null,
          breaks,
        })
      : { price: listPrice, source: "default" as const, listPrice, savedPct: 0 };
    return {
      variantId: item.variantId,
      displayTitle: item.displayTitle,
      sku: item.sku,
      currencyCode: item.currencyCode,
      listPrice: item.price,
      yourPrice: resolved.price.toFixed(2),
      savedPct: Math.round(resolved.savedPct * 100),
      hasVolume: Boolean(breaks && breaks.length > 0),
      custom: resolved.source !== "default",
    };
  });

  return { items, catalogError, company: buyer.company.name };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const buyer = await loadBuyer(request);
  const form = await request.formData();
  const selections = parseQuoteSelections(form);

  let catalog: CatalogItem[];
  try {
    catalog = await getVisibleCatalog(buyer.company.shop.shopifyDomain, { buyerId: buyer.id, companyId: buyer.companyId });
  } catch {
    return { error: "We couldn’t load the catalog just now. Please try again." };
  }

  const result = await submitBuyerQuote(
    { id: buyer.id, companyId: buyer.companyId },
    selections,
    catalog,
  );
  if (!result.ok) return { error: result.error };
  return redirect(`/portal/quotes/${result.quote.id}`);
};

export default function NewQuote() {
  const { items, catalogError, company } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const setQty = (variantId: string, value: string) =>
    setQuantities((prev) => ({ ...prev, [variantId]: value }));

  if (catalogError) {
    return (
      <section className="portal-card">
        <h1>Request a quote</h1>
        <p className="error">
          We couldn’t load the catalog right now. Please refresh, or contact your
          supplier if it keeps happening.
        </p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="portal-card">
        <h1>Request a quote</h1>
        <p className="muted">
          {company} hasn’t published any products yet. Check back soon.
        </p>
      </section>
    );
  }

  return (
    <section className="portal-card">
      <h1>Request a quote</h1>
      <p className="muted">
        Enter the quantities you’d like. Your supplier will review and send back
        pricing.
      </p>
      {actionData?.error && (
        <p className="error" role="alert">
          {actionData.error}
        </p>
      )}
      <Form method="post">
        <ul className="catalog-list">
          {items.map((item) => (
            <li key={item.variantId} className="catalog-row">
              <div className="catalog-info">
                <span className="catalog-title">{item.displayTitle}</span>
                {item.sku && <span className="muted"> · {item.sku}</span>}
                {item.custom && item.savedPct > 0 ? (
                  <span>
                    {" "}
                    · <s className="muted">{item.currencyCode} {item.listPrice}</s>{" "}
                    <strong>
                      {item.currencyCode} {item.yourPrice}
                    </strong>{" "}
                    <span className="save-badge">You save {item.savedPct}%</span>
                  </span>
                ) : (
                  <span className="muted">
                    {" "}
                    · {item.currencyCode} {item.custom ? item.yourPrice : item.listPrice}
                  </span>
                )}
                {item.hasVolume && (
                  <span className="muted"> · volume pricing available</span>
                )}
              </div>
              <label className="catalog-qty">
                <span className="visually-hidden">
                  Quantity for {item.displayTitle}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  name={`quantity_${item.variantId}`}
                  value={quantities[item.variantId] ?? ""}
                  onChange={(e) => setQty(item.variantId, e.target.value)}
                  placeholder="0"
                />
              </label>
            </li>
          ))}
        </ul>
        <button type="submit" className="portal-button" disabled={submitting}>
          {submitting ? "Submitting…" : "Request quote"}
        </button>
      </Form>
    </section>
  );
}
