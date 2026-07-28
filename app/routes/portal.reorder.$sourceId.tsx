import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import { getVisibleCatalog } from "../services/catalogs.server";
import {
  buildReorderLines,
  createReorder,
  fetchOrderLines,
  type ReorderLine,
} from "../services/reorder.server";
import { QuoteCapReachedError } from "../services/plan-limits.server";
import { QUOTE_CAP_BUYER_MESSAGE } from "../lib/billing";

async function loadContext(request: Request, sourceId: string | undefined) {
  const buyerId = await requireBuyerId(request);
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { company: { include: { shop: true } } },
  });
  if (!buyer) throw redirect("/portal/signin");
  const source = await prisma.reorderSource.findFirst({
    where: { id: sourceId, companyId: buyer.companyId },
  });
  if (!source) throw new Response("Order not found", { status: 404 });
  return { buyer, source };
}

async function resolveReorderLines(
  shop: string,
  shopifyOrderId: string,
  buyerCtx: { buyerId: string; companyId: string },
) {
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(shop);
  // F11 — reorder only from what this buyer may see; a hidden SKU in a past
  // order won't reappear in their cart.
  const [orderLines, catalog] = await Promise.all([
    fetchOrderLines(admin, shopifyOrderId),
    getVisibleCatalog(shop, buyerCtx),
  ]);
  return { admin, catalog, ...buildReorderLines(orderLines, catalog) };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { buyer, source } = await loadContext(request, params.sourceId);
  try {
    const { lines, unavailable } = await resolveReorderLines(buyer.company.shop.shopifyDomain, source.shopifyOrderId, { buyerId: buyer.id, companyId: buyer.companyId });
    return { ok: true as const, orderName: source.orderName, lines, unavailableCount: unavailable.length };
  } catch {
    return { ok: false as const, orderName: source.orderName, lines: [] as ReorderLine[], unavailableCount: 0 };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { buyer, source } = await loadContext(request, params.sourceId);
  const form = await request.formData();

  let resolved;
  try {
    resolved = await resolveReorderLines(buyer.company.shop.shopifyDomain, source.shopifyOrderId, { buyerId: buyer.id, companyId: buyer.companyId });
  } catch {
    return { error: "We couldn’t load this order just now. Please try again." };
  }

  // Apply buyer-adjusted quantities (drop anything set to 0).
  const adjusted: ReorderLine[] = [];
  for (const line of resolved.lines) {
    const raw = form.get(`quantity_${line.variantId}`);
    const quantity = raw != null && String(raw).trim() !== "" ? Number(raw) : line.quantity;
    if (Number.isInteger(quantity) && quantity > 0) {
      adjusted.push({ ...line, quantity });
    }
  }
  if (adjusted.length === 0) {
    return { error: "Add at least one item to reorder." };
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: buyer.company.shop.shopifyDomain },
    select: { autoApproveTolerance: true },
  });
  const currencyCode = resolved.catalog[0]?.currencyCode ?? "USD";

  const poReference = String(form.get("poReference") ?? "").trim() || null;

  let result;
  try {
    result = await createReorder({
      companyId: buyer.companyId,
      buyerId: buyer.id,
      lines: adjusted,
      tolerance: shop?.autoApproveTolerance ?? 0,
      poReference,
      autoConvert: { admin: resolved.admin, currencyCode },
    });
  } catch (error) {
    if (error instanceof QuoteCapReachedError) {
      return { error: QUOTE_CAP_BUYER_MESSAGE };
    }
    throw error;
  }
  return redirect(`/portal/quotes/${result.quote.id}`);
};

export default function Reorder() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  if (!data.ok || data.lines.length === 0) {
    return (
      <section className="portal-card">
        <h1>Reorder {data.orderName}</h1>
        <p className="error">
          {data.ok
            ? "None of the items on this order are available to reorder right now."
            : "We couldn’t load this order. Please refresh and try again."}
        </p>
        <p>
          <Link to="/portal" className="portal-link">
            ← Back to portal
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="portal-card">
      <h1>Reorder {data.orderName}</h1>
      <p className="muted">
        Adjust quantities if you need to, then send your reorder.
      </p>
      {data.unavailableCount > 0 && (
        <p className="muted">
          {data.unavailableCount} item(s) from this order are no longer available
          and were left off.
        </p>
      )}
      {actionData?.error && (
        <p className="error" role="alert">
          {actionData.error}
        </p>
      )}
      <Form method="post">
        <ul className="catalog-list">
          {data.lines.map((line) => (
            <li key={line.variantId} className="catalog-row">
              <div className="catalog-info">
                <span className="catalog-title">{line.title}</span>
                {line.sku && <span className="muted"> · {line.sku}</span>}
              </div>
              <label className="catalog-qty">
                <span className="visually-hidden">Quantity for {line.title}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  name={`quantity_${line.variantId}`}
                  value={quantities[line.variantId] ?? String(line.quantity)}
                  onChange={(e) =>
                    setQuantities((prev) => ({ ...prev, [line.variantId]: e.target.value }))
                  }
                />
              </label>
            </li>
          ))}
        </ul>
        <label className="field">
          <span className="field-label">PO reference (optional)</span>
          <input type="text" name="poReference" placeholder="e.g. PO-2026-001" />
        </label>
        <button type="submit" className="portal-button" disabled={submitting}>
          {submitting ? "Sending…" : "Send reorder"}
        </button>
      </Form>
    </section>
  );
}
