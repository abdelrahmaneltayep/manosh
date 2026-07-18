import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import { getCatalog, type CatalogItem } from "../services/catalog.server";
import { parseSkuQuantityText, resolveSkuLines } from "../services/quick-order.server";
import {
  UNRESOLVED_MESSAGE,
  type ResolvedLine,
  type UnresolvedRow,
} from "../lib/quick-order";
import {
  parseQuoteSelections,
  submitBuyerQuote,
} from "../services/portal-quote.server";
import { parseOrderPad } from "../services/ai/order-parser.server";
import { appendEvent } from "../services/events.server";

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
  await loadBuyer(request);
  return null;
};

type ActionResult =
  | {
      step: "resolved";
      resolved: ResolvedLine[];
      unresolved: UnresolvedRow[];
      /** Set when the lines came from the AI parse (drives the confirm event). */
      ai?: { rate: number };
    }
  | { step: "error"; error: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const buyer = await loadBuyer(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "resolve");

  let catalog: CatalogItem[];
  try {
    catalog = await getCatalog(buyer.company.shop.shopifyDomain);
  } catch {
    return { step: "error", error: "We couldn’t load the catalog. Please try again." } satisfies ActionResult;
  }

  if (intent === "submit") {
    const selections = parseQuoteSelections(form);
    const result = await submitBuyerQuote(
      { id: buyer.id, companyId: buyer.companyId },
      selections,
      catalog,
    );
    if (!result.ok) return { step: "error", error: result.error } satisfies ActionResult;

    // The AI never acts autonomously — the cart is built only here, on explicit
    // confirm. Log acceptance (with the accepted-as-is rate) for AI submits.
    if (form.get("source") === "ai") {
      await appendEvent({
        shopId: buyer.company.shopId,
        type: "AI_PARSE_ACCEPTED",
        entityType: "Quote",
        entityId: result.quote.id,
        payload: { acceptedAsIsRate: Number(form.get("aiRate") ?? 0) },
      });
    }
    return redirect(`/portal/quotes/${result.quote.id}`);
  }

  if (intent === "ai-parse") {
    let validated;
    try {
      validated = await parseOrderPad(String(form.get("blob") ?? ""), catalog);
    } catch {
      return {
        step: "error",
        error: "We couldn’t read that order automatically. Try the SKU box instead.",
      } satisfies ActionResult;
    }
    // Reuse the same confirm UI: AI matched lines → resolved cart, unmatched
    // text → flagged rows the buyer resolves manually.
    return {
      step: "resolved",
      ai: { rate: validated.acceptedAsIsRate },
      resolved: validated.matched.map((line) => ({
        variantId: line.variantId,
        sku: line.sku ?? "",
        title: line.title,
        quantity: line.quantity,
        price: line.price,
      })),
      unresolved: validated.unmatched.map((raw) => ({
        sku: "",
        quantity: 0,
        raw,
        reason: "unknown-sku" as const,
      })),
    } satisfies ActionResult;
  }

  const rows = parseSkuQuantityText(String(form.get("pasted") ?? ""));
  const { resolved, unresolved } = resolveSkuLines(rows, catalog);
  return { step: "resolved", resolved, unresolved } satisfies ActionResult;
};

export default function QuickOrder() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const resolved = actionData?.step === "resolved" ? actionData.resolved : [];
  const unresolved = actionData?.step === "resolved" ? actionData.unresolved : [];
  const ai =
    actionData?.step === "resolved" && "ai" in actionData ? actionData.ai : undefined;

  const [quantities, setQuantities] = useState<Record<string, string>>({});

  return (
    <section className="portal-card">
      <h1>Quick order</h1>
      <p className="muted">
        Paste one SKU and quantity per line (e.g. <code>A-1, 5</code>). We’ll
        match them to the catalog.
      </p>

      {actionData?.step === "error" && (
        <p className="error" role="alert">
          {actionData.error}
        </p>
      )}

      <Form method="post">
        <input type="hidden" name="intent" value="resolve" />
        <label htmlFor="pasted" className="visually-hidden">
          SKUs and quantities, one per line
        </label>
        <textarea
          id="pasted"
          name="pasted"
          rows={6}
          className="quick-order-input"
          placeholder={"A-1, 5\nB-2, 2"}
        />
        <button type="submit" className="portal-button" disabled={busy}>
          Match to catalog
        </button>
      </Form>

      <h2 className="portal-subhead">Or paste a PO or email</h2>
      <p className="muted">
        Paste a purchase order, email, or spreadsheet and we’ll match it to the
        catalog for you. You’ll review everything before anything is ordered.
      </p>
      <Form method="post">
        <input type="hidden" name="intent" value="ai-parse" />
        <label htmlFor="blob" className="visually-hidden">
          Paste your purchase order or email
        </label>
        <textarea
          id="blob"
          name="blob"
          rows={6}
          className="quick-order-input"
          placeholder={"Hi — please send us 10 widgets (A-1) and 4 of the blue gadgets…"}
        />
        <button type="submit" className="portal-button" disabled={busy}>
          Read my order
        </button>
      </Form>

      {actionData?.step === "resolved" && (
        <div className="quick-order-results">
          {unresolved.length > 0 && (
            <div className="quick-order-unresolved" role="alert">
              <h2 className="portal-subhead">Couldn’t match {unresolved.length} line(s)</h2>
              <ul className="catalog-list">
                {unresolved.map((row, i) => (
                  <li key={`${row.raw}-${i}`} className="catalog-row">
                    <span className="catalog-title">{row.raw || "(empty line)"}</span>
                    <span className="error">{UNRESOLVED_MESSAGE[row.reason]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resolved.length === 0 ? (
            <p className="muted">Nothing matched yet — fix the lines above and try again.</p>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="submit" />
              {ai && (
                <>
                  <input type="hidden" name="source" value="ai" />
                  <input type="hidden" name="aiRate" value={String(ai.rate)} />
                </>
              )}
              <h2 className="portal-subhead">Your cart</h2>
              <ul className="catalog-list">
                {resolved.map((line) => (
                  <li key={line.variantId} className="catalog-row">
                    <div className="catalog-info">
                      <span className="catalog-title">{line.title}</span>
                      <span className="muted"> · {line.sku}</span>
                    </div>
                    <label className="catalog-qty">
                      <span className="visually-hidden">Quantity for {line.title}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
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
              <button type="submit" className="portal-button" disabled={busy}>
                Request quote for these items
              </button>
            </Form>
          )}
        </div>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        <Link to="/portal" className="portal-link">
          ← Back to portal
        </Link>
      </p>
    </section>
  );
}
