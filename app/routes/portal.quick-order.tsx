import { useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import { getCatalog, type CatalogItem } from "../services/catalog.server";
import { resolveSkuLines, parseSkuQuantityText } from "../lib/quick-order";
import { getCompanyPricing } from "../services/price-list.server";
import { getRulesForShop } from "../services/order-rules.server";
import { evaluateCart, shortfallMessage, type OrderRuleLite } from "../lib/order-rules";
import { parseOrderPad } from "../services/ai/order-parser.server";
import {
  listSavedLists,
  createSavedList,
  getSavedListItems,
  deleteSavedList,
  SavedListCapError,
} from "../services/saved-order.server";
import { submitBuyerQuote } from "../services/portal-quote.server";
import { appendEvent } from "../services/events.server";
import { getPlanLimits, savedListCapMessage } from "../lib/billing";
import { resolvePrice } from "../lib/price-resolver";
import { orderPadSubtotal, parseOrderPadCsv, type PricedLine } from "../lib/order-pad";
import { UNRESOLVED_MESSAGE } from "../lib/quick-order";

const ENABLED = () => process.env.MANNON_FF_ORDERPAD === "true";

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
  const shopDomain = buyer.company.shop.shopifyDomain;

  let catalog: CatalogItem[] = [];
  let catalogError = false;
  try {
    catalog = await getCatalog(shopDomain);
  } catch {
    catalogError = true;
  }

  const pricing = await getCompanyPricing(buyer.companyId);
  const items = catalog.map((item) => ({
    variantId: item.variantId,
    sku: item.sku,
    title: item.displayTitle,
    currency: item.currencyCode,
    listPrice: Number(item.price),
    entryPrice: pricing.entriesByVariant.get(item.variantId) ?? null,
    breaks: pricing.breaksByVariant.get(item.variantId) ?? null,
  }));

  const plan = buyer.company.shop.plan;
  const limits = getPlanLimits(plan);
  const savedLists = await listSavedLists(buyer.companyId);
  const moqEnabled = process.env.MANNON_FF_MOQ === "true";
  const orderRules: OrderRuleLite[] = moqEnabled ? await getRulesForShop(shopDomain) : [];

  // Deep-link: /portal/quick-order?list=<id> preloads a saved list into the pad.
  const listId = new URL(request.url).searchParams.get("list");
  const prefill = listId ? await getSavedListItems(buyer.companyId, listId) : [];

  return {
    enabled: ENABLED(),
    catalogError,
    company: buyer.company.name,
    currency: items[0]?.currency ?? "USD",
    items,
    savedLists: ENABLED() ? savedLists : [],
    moqEnabled,
    orderRules,
    companyId: buyer.companyId,
    isGrowth: plan === "GROWTH",
    savedListCap: Number.isFinite(limits.savedListCap) ? limits.savedListCap : null,
    savedUsed: savedLists.length,
    prefill,
  };
};

type MergeResult = {
  kind: "merge";
  resolved: Array<{ variantId: string; qty: number }>;
  unresolved: Array<{ raw: string; reason: keyof typeof UNRESOLVED_MESSAGE }>;
  errors: string[];
};
type ActionResult =
  | MergeResult
  | { kind: "saved"; message: string }
  | { kind: "error"; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Response | ActionResult> => {
  const buyer = await loadBuyer(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const plan = buyer.company.shop.plan;

  if (intent === "submit") {
    const selections: Array<{ variantId: string; quantity: number }> = [];
    for (const [key, value] of form.entries()) {
      const m = key.match(/^qty_(.+)$/);
      if (m) {
        const quantity = Number(value);
        if (Number.isInteger(quantity) && quantity >= 1) selections.push({ variantId: m[1], quantity });
      }
    }
    let catalog: CatalogItem[];
    try {
      catalog = await getCatalog(buyer.company.shop.shopifyDomain);
    } catch {
      return { kind: "error", error: "We couldn’t load the catalog. Please try again." };
    }
    const result = await submitBuyerQuote({ id: buyer.id, companyId: buyer.companyId }, selections, catalog);
    if (!result.ok) return { kind: "error", error: result.error };
    await appendEvent({
      shopId: buyer.company.shopId,
      type: "ORDERPAD_USED",
      entityType: "Quote",
      entityId: result.quote.id,
      payload: { lines: selections.length },
    });
    return redirect(`/portal/quotes/${result.quote.id}`);
  }

  if (intent === "save-list") {
    if (!ENABLED()) return { kind: "error", error: "Saved lists aren’t available yet." };
    const name = String(form.get("name") ?? "");
    let items: Array<{ variantId: string; qty: number }> = [];
    try {
      items = JSON.parse(String(form.get("items") ?? "[]"));
    } catch {
      items = [];
    }
    if (items.length === 0) return { kind: "error", error: "Add some items before saving a list." };
    const cap = getPlanLimits(plan).savedListCap;
    try {
      await createSavedList(buyer.companyId, name, items, cap);
      return { kind: "saved", message: "List saved." };
    } catch (error) {
      if (error instanceof SavedListCapError) return { kind: "error", error: savedListCapMessage(error.cap) };
      throw error;
    }
  }

  if (intent === "delete-list") {
    await deleteSavedList(buyer.companyId, String(form.get("listId") ?? ""));
    return { kind: "saved", message: "List removed." };
  }

  // CSV upload is Growth-only.
  if (intent === "import-csv") {
    if (!ENABLED()) return { kind: "error", error: "CSV upload isn’t available yet." };
    if (plan !== "GROWTH") {
      return { kind: "error", error: "CSV upload is a Growth feature. Ask the store to upgrade." };
    }
    const { rows, errors } = parseOrderPadCsv(String(form.get("csv") ?? ""));
    let catalog: CatalogItem[];
    try {
      catalog = await getCatalog(buyer.company.shop.shopifyDomain);
    } catch {
      return { kind: "error", error: "We couldn’t load the catalog. Please try again." };
    }
    const { resolved, unresolved } = resolveSkuLines(
      rows.map((r) => ({ sku: r.sku, quantity: r.qty, raw: `${r.sku},${r.qty}` })),
      catalog,
    );
    return {
      kind: "merge",
      resolved: resolved.map((l) => ({ variantId: l.variantId, qty: l.quantity })),
      unresolved: unresolved.map((u) => ({ raw: u.raw, reason: u.reason })),
      errors,
    };
  }

  if (intent === "ai-parse") {
    let catalog: CatalogItem[];
    try {
      catalog = await getCatalog(buyer.company.shop.shopifyDomain);
    } catch {
      return { kind: "error", error: "We couldn’t load the catalog. Please try again." };
    }
    let validated;
    try {
      validated = await parseOrderPad(String(form.get("blob") ?? ""), catalog);
    } catch {
      return { kind: "error", error: "We couldn’t read that automatically. Try the search or paste box." };
    }
    return {
      kind: "merge",
      resolved: validated.matched.map((l) => ({ variantId: l.variantId, qty: l.quantity })),
      unresolved: validated.unmatched.map((raw) => ({ raw, reason: "unknown-sku" as const })),
      errors: [],
    };
  }

  return { kind: "error", error: "Unknown action." };
};

interface CartLine {
  variantId: string;
  sku: string;
  title: string;
  qty: number;
}

export default function OrderPad() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const merge = useFetcher<typeof action>();
  const save = useFetcher<typeof action>();
  const busy = navigation.state === "submitting";

  const byVariant = useMemo(() => new Map(data.items.map((i) => [i.variantId, i])), [data.items]);

  // Client-owned cart, keyed by variant. Seeded from a ?list= deep link.
  const [cart, setCart] = useState<Record<string, CartLine>>(() => {
    const seed: Record<string, CartLine> = {};
    for (const p of data.prefill) {
      const item = data.items.find((i) => i.variantId === p.variantId);
      if (item) seed[p.variantId] = { variantId: p.variantId, sku: item.sku ?? "", title: item.title, qty: p.qty };
    }
    return seed;
  });
  const [pasted, setPasted] = useState("");
  const [csv, setCsv] = useState("");
  const [blob, setBlob] = useState("");
  const [search, setSearch] = useState("");
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const cartLines = Object.values(cart);

  const addToCart = (variantId: string, qty: number) => {
    const item = byVariant.get(variantId);
    if (!item || qty < 1) return;
    setCart((prev) => {
      const existing = prev[variantId];
      return {
        ...prev,
        [variantId]: {
          variantId,
          sku: item.sku ?? "",
          title: item.title,
          qty: (existing?.qty ?? 0) + qty,
        },
      };
    });
  };
  const setQty = (variantId: string, qty: number) =>
    setCart((prev) => ({ ...prev, [variantId]: { ...prev[variantId], qty } }));
  const removeLine = (variantId: string) =>
    setCart((prev) => {
      const next = { ...prev };
      delete next[variantId];
      return next;
    });

  // Merge server results (CSV / AI parse) into the cart.
  const mergedRef = useRef<unknown>(null);
  if (merge.data && merge.data !== mergedRef.current && "kind" in merge.data && merge.data.kind === "merge") {
    mergedRef.current = merge.data;
    const res = merge.data;
    setTimeout(() => {
      setCart((prev) => {
        const next = { ...prev };
        for (const r of res.resolved) {
          const item = byVariant.get(r.variantId);
          if (item) {
            next[r.variantId] = {
              variantId: r.variantId,
              sku: item.sku ?? "",
              title: item.title,
              qty: (next[r.variantId]?.qty ?? 0) + r.qty,
            };
          }
        }
        return next;
      });
    }, 0);
  }
  const mergeErrors =
    merge.data && "kind" in merge.data && merge.data.kind === "merge"
      ? [
          ...merge.data.errors,
          ...merge.data.unresolved.map(
            (u: { raw: string; reason: keyof typeof UNRESOLVED_MESSAGE }) =>
              `${u.raw || "(empty)"} — ${UNRESOLVED_MESSAGE[u.reason]}`,
          ),
        ]
      : [];
  const mergeError = merge.data && "kind" in merge.data && merge.data.kind === "error" ? merge.data.error : null;
  const saveMsg = save.data && "kind" in save.data && save.data.kind === "saved" ? save.data.message : null;
  const saveErr = save.data && "kind" in save.data && save.data.kind === "error" ? save.data.error : null;

  // Live subtotal via the F3 resolver.
  const totals = useMemo(() => {
    const priced: PricedLine[] = cartLines.map((l) => {
      const item = byVariant.get(l.variantId);
      return {
        quantity: l.qty,
        listPrice: item?.listPrice ?? 0,
        entryPrice: item?.entryPrice ?? null,
        breaks: item?.breaks ?? null,
      };
    });
    return orderPadSubtotal(priced);
  }, [cart, byVariant]);

  const unitPrice = (variantId: string, qty: number): number => {
    const item = byVariant.get(variantId);
    if (!item) return 0;
    return resolvePrice(qty || 1, { listPrice: item.listPrice, entryPrice: item.entryPrice, breaks: item.breaks }).price;
  };

  // F9 — live order-rule evaluation (MOQ / pack / min order value).
  const ruleEval = useMemo(() => {
    if (!data.moqEnabled || data.orderRules.length === 0) return null;
    return evaluateCart(
      cartLines.map((l) => ({ variantId: l.variantId, qty: l.qty, price: unitPrice(l.variantId, l.qty) })),
      data.orderRules,
      { companyId: data.companyId },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, data.moqEnabled, data.orderRules, data.companyId]);
  const ruleByVariant = useMemo(
    () => new Map((ruleEval?.lines ?? []).map((l) => [l.variantId, l])),
    [ruleEval],
  );

  const results = search.trim()
    ? data.items
        .filter((i) => {
          const q = search.toLowerCase();
          return (i.sku ?? "").toLowerCase().includes(q) || i.title.toLowerCase().includes(q);
        })
        .slice(0, 6)
    : [];

  const doPaste = () => {
    const rows = parseSkuQuantityText(pasted);
    const lite = data.items.map((i) => ({
      variantId: i.variantId,
      sku: i.sku,
      displayTitle: i.title,
      price: String(i.listPrice),
    }));
    const { resolved, unresolved } = resolveSkuLines(rows, lite);
    for (const l of resolved) addToCart(l.variantId, l.quantity);
    setPasted("");
    if (unresolved.length) {
      setNotice(`${unresolved.length} line(s) couldn't be matched: ` +
        unresolved.map((u) => `${u.raw} (${UNRESOLVED_MESSAGE[u.reason]})`).slice(0, 3).join("; "));
    } else {
      setNotice(null);
    }
  };

  const reorderSaved = async (listId: string) => {
    // Saved items are fetched from the server (they carry only variant+qty).
    const res = await fetch(`/portal/quick-order/list/${listId}`);
    if (!res.ok) return;
    const items: Array<{ variantId: string; qty: number }> = await res.json();
    for (const it of items) addToCart(it.variantId, it.qty);
  };

  if (data.catalogError) {
    return (
      <section className="portal-card">
        <h1>Order pad</h1>
        <p className="error">We couldn’t load the catalog right now. Please refresh.</p>
      </section>
    );
  }

  return (
    <section className="portal-card">
      <h1>Order pad</h1>
      <p className="muted">
        Search a SKU or product, paste a list, or reorder a saved one. Prices are
        yours — the subtotal updates as you go.
      </p>

      {/* Search (keyboard-first) */}
      {data.enabled && (
        <>
          <label className="field-label" htmlFor="op-search">
            Add by SKU or product
          </label>
          <input
            id="op-search"
            ref={searchRef}
            className="quick-order-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                e.preventDefault();
                addToCart(results[0].variantId, 1);
                setSearch("");
                searchRef.current?.focus();
              }
            }}
            placeholder="Type a SKU or name, then Enter"
            autoComplete="off"
          />
          {results.length > 0 && (
            <ul className="catalog-list" aria-label="Search results">
              {results.map((r) => (
                <li key={r.variantId} className="catalog-row">
                  <span className="catalog-title">
                    {r.title} {r.sku && <span className="muted">· {r.sku}</span>}
                  </span>
                  <button
                    type="button"
                    className="portal-link-button"
                    onClick={() => {
                      addToCart(r.variantId, 1);
                      setSearch("");
                      searchRef.current?.focus();
                    }}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Paste */}
      <h2 className="portal-subhead">Paste SKUs</h2>
      <textarea
        className="quick-order-input"
        rows={4}
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder={"A-1, 5\nB-2, 2"}
      />
      <button type="button" className="portal-button" onClick={doPaste}>
        Add pasted lines
      </button>
      {notice && (
        <p className="quick-order-unresolved" role="alert">
          {notice}
        </p>
      )}

      {/* CSV (Growth) + AI parse */}
      {data.enabled && (
        <>
          <h2 className="portal-subhead">Upload CSV {data.isGrowth ? "" : "(Growth)"}</h2>
          {data.isGrowth ? (
            <merge.Form method="post">
              <input type="hidden" name="intent" value="import-csv" />
              <textarea
                className="quick-order-input"
                name="csv"
                rows={3}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={"sku,qty\nA-1,5"}
              />
              <button type="submit" className="portal-button" disabled={merge.state !== "idle"}>
                Import CSV
              </button>
            </merge.Form>
          ) : (
            <p className="muted">CSV upload is available on the store’s Growth plan.</p>
          )}
        </>
      )}
      {mergeError && <p className="error" role="alert">{mergeError}</p>}
      {mergeErrors.length > 0 && (
        <div className="quick-order-unresolved" role="alert">
          <strong>Some lines need attention:</strong>
          <ul>
            {mergeErrors.slice(0, 8).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="portal-subhead">Paste a PO or email</h2>
      <merge.Form method="post">
        <input type="hidden" name="intent" value="ai-parse" />
        <textarea
          className="quick-order-input"
          name="blob"
          rows={3}
          value={blob}
          onChange={(e) => setBlob(e.target.value)}
          placeholder="Hi — please send 10 of A-1 and 4 blue gadgets…"
        />
        <button type="submit" className="portal-button" disabled={merge.state !== "idle"}>
          Read my order
        </button>
      </merge.Form>

      {/* Cart + live subtotal */}
      <h2 className="portal-subhead">Your order ({cartLines.length} item{cartLines.length === 1 ? "" : "s"})</h2>
      {cartLines.length === 0 ? (
        <p className="muted">
          Nothing here yet. Search above, paste a list, or reorder a saved one to
          get started.
        </p>
      ) : (
        <>
          <ul className="catalog-list">
            {cartLines.map((l) => (
              <li key={l.variantId} className="catalog-row">
                <div className="catalog-info">
                  <span className="catalog-title">{l.title}</span>
                  {l.sku && <span className="muted"> · {l.sku}</span>}
                  <span className="muted">
                    {" "}
                    · {data.currency} {unitPrice(l.variantId, l.qty).toFixed(2)} ea
                  </span>
                  {ruleByVariant.get(l.variantId)?.changed && (
                    <span className="save-badge" style={{ background: "#eceafb", color: "#3730a3" }}>
                      {ruleByVariant.get(l.variantId)!.reason}
                    </span>
                  )}
                </div>
                <label className="catalog-qty">
                  <span className="visually-hidden">Quantity for {l.title}</span>
                  <input
                    type="number"
                    min={1}
                    value={String(l.qty)}
                    onChange={(e) => setQty(l.variantId, Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                <button type="button" className="portal-link-button" onClick={() => removeLine(l.variantId)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="totals">
            {totals.saved > 0 && (
              <div className="totals-row">
                <span>List price</span>
                <span><s>{data.currency} {totals.listSubtotal.toFixed(2)}</s></span>
              </div>
            )}
            <div className="totals-row totals-total">
              <span>Subtotal</span>
              <span>
                {data.currency} {totals.subtotal.toFixed(2)}
                {totals.saved > 0 && <span className="save-badge"> You save {data.currency} {totals.saved.toFixed(2)}</span>}
              </span>
            </div>
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              Final tax &amp; totals are calculated by the store at checkout.
            </p>

            {/* F9 — minimum order value progress */}
            {ruleEval && ruleEval.minOrderValue != null && (
              <div style={{ marginTop: "0.75rem" }}>
                <div
                  style={{
                    height: "8px",
                    borderRadius: "999px",
                    background: "#eae7f2",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, (ruleEval.subtotal / ruleEval.minOrderValue) * 100).toFixed(0)}%`,
                      background: ruleEval.ok ? "#c6e94b" : "#4f46e5",
                    }}
                  />
                </div>
                <p className={ruleEval.ok ? "muted" : "error"} style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
                  {ruleEval.ok
                    ? `Minimum order of ${data.currency} ${ruleEval.minOrderValue.toFixed(2)} met.`
                    : shortfallMessage(data.currency, ruleEval.shortfall, ruleEval.minOrderValue)}
                </p>
              </div>
            )}
          </div>

          {/* Submit as a quote */}
          <form
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData();
              fd.set("intent", "submit");
              for (const l of cartLines) fd.set(`qty_${l.variantId}`, String(l.qty));
              submit(fd, { method: "post" });
            }}
          >
            <button type="submit" className="portal-button" disabled={busy}>
              Request quote for these items
            </button>
          </form>

          {/* Save as list */}
          {data.enabled && (
          <div style={{ marginTop: "1rem" }}>
            <label className="field-label" htmlFor="op-savename">
              Save as list
            </label>
            <div className="portal-actions">
              <input
                id="op-savename"
                className="quick-order-input"
                style={{ maxWidth: "16rem", marginBottom: 0 }}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. Monthly reorder"
              />
              <button
                type="button"
                className="portal-button"
                disabled={save.state !== "idle" || (data.savedListCap !== null && data.savedUsed >= data.savedListCap)}
                onClick={() =>
                  save.submit(
                    {
                      intent: "save-list",
                      name: saveName,
                      items: JSON.stringify(cartLines.map((l) => ({ variantId: l.variantId, qty: l.qty }))),
                    },
                    { method: "post" },
                  )
                }
              >
                Save list
              </button>
            </div>
            {data.savedListCap !== null && data.savedUsed >= data.savedListCap && (
              <p className="muted">{savedListCapMessage(data.savedListCap)}</p>
            )}
            {saveErr && <p className="error">{saveErr}</p>}
            {saveMsg && <p className="muted">{saveMsg}</p>}
          </div>
          )}
        </>
      )}

      {/* Saved lists */}
      {data.savedLists.length > 0 && (
        <>
          <h2 className="portal-subhead">Saved lists</h2>
          <ul className="quote-list">
            {data.savedLists.map((l) => (
              <li key={l.id} className="quote-list-row">
                <span>
                  <strong>{l.name}</strong>
                  <span className="muted"> · {l.itemCount} item{l.itemCount === 1 ? "" : "s"}</span>
                </span>
                <span className="portal-actions">
                  <button type="button" className="portal-link" onClick={() => reorderSaved(l.id)}>
                    Reorder
                  </button>
                  <button
                    type="button"
                    className="portal-link-button"
                    onClick={() => save.submit({ intent: "delete-list", listId: l.id }, { method: "post" })}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        <Link to="/portal" className="portal-link">
          ← Back to portal
        </Link>
      </p>
    </section>
  );
}
