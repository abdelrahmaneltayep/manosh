import { useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useLoaderData, useFetcher } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import { type CatalogItem } from "../services/catalog.server";
import { getVisibleCatalog } from "../services/catalogs.server";
import {
  PWA_ENABLED,
  listShortcuts,
  createShortcut,
  deleteShortcut,
  oneTapReorder,
  vapidPublicKey,
  ShortcutCapError,
} from "../services/pwa.server";
import { getPlanLimits, pushRemindersAllowed, shortcutCapMessage } from "../lib/billing";

/**
 * F18 — the buyer's "one-tap reorder" home: saved shortcuts (bundles) they can
 * reorder in a single tap from the installed app, plus create/delete and (on
 * Growth) opt-in push reminders. Progressive enhancement — works as plain HTML
 * even when the PWA isn't installed. Dark-launched behind MANNON_FF_BUYER_PWA.
 */

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
  if (!PWA_ENABLED()) throw new Response("Not found", { status: 404 });
  const buyer = await loadBuyer(request);
  const plan = buyer.company.shop.plan;
  const limits = getPlanLimits(plan);

  let catalog: CatalogItem[] = [];
  let catalogError = false;
  try {
    catalog = await getVisibleCatalog(buyer.company.shop.shopifyDomain, { buyerId: buyer.id, companyId: buyer.companyId });
  } catch {
    catalogError = true;
  }

  const shortcuts = await listShortcuts(buyer.id);
  return {
    company: buyer.company.name,
    catalogError,
    shortcuts,
    items: catalog.map((i) => ({ variantId: i.variantId, sku: i.sku, title: i.displayTitle })),
    shortcutCap: Number.isFinite(limits.reorderShortcutCap) ? limits.reorderShortcutCap : null,
    used: shortcuts.length,
    pushAllowed: pushRemindersAllowed(plan),
    vapidPublicKey: vapidPublicKey(),
  };
};

type ActionResult =
  | { kind: "created"; message: string }
  | { kind: "deleted" }
  | { kind: "error"; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Response | ActionResult> => {
  if (!PWA_ENABLED()) throw new Response("Not found", { status: 404 });
  const buyer = await loadBuyer(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "reorder") {
    const result = await oneTapReorder(buyer.id, String(form.get("shortcutId") ?? "") || null);
    if (!result.ok) return { kind: "error", error: result.error };
    return redirect(`/portal/quotes/${result.quoteId}`);
  }

  if (intent === "create") {
    const label = form.get("label");
    let lines: unknown = [];
    try {
      lines = JSON.parse(String(form.get("lines") ?? "[]"));
    } catch {
      lines = [];
    }
    try {
      await createShortcut(buyer.id, label, lines, buyer.company.shop.plan);
      return { kind: "created", message: "Shortcut saved. Reorder it in one tap next time." };
    } catch (error) {
      if (error instanceof ShortcutCapError) return { kind: "error", error: shortcutCapMessage(error.cap) };
      return { kind: "error", error: error instanceof Error ? error.message : "Couldn’t save that shortcut." };
    }
  }

  if (intent === "delete") {
    await deleteShortcut(buyer.id, String(form.get("shortcutId") ?? ""));
    return { kind: "deleted" };
  }

  return { kind: "error", error: "Unknown action." };
};

interface BuildLine {
  variantId: string;
  title: string;
  sku: string | null;
  qty: number;
}

export default function Shortcuts() {
  const data = useLoaderData<typeof loader>();
  const create = useFetcher<typeof action>();
  const del = useFetcher<typeof action>();

  const byVariant = useMemo(() => new Map(data.items.map((i) => [i.variantId, i])), [data.items]);
  const [cart, setCart] = useState<Record<string, BuildLine>>({});
  const [search, setSearch] = useState("");
  const [label, setLabel] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const cartLines = Object.values(cart);

  const addToCart = (variantId: string) => {
    const item = byVariant.get(variantId);
    if (!item) return;
    setCart((prev) => ({
      ...prev,
      [variantId]: { variantId, title: item.title, sku: item.sku, qty: (prev[variantId]?.qty ?? 0) + 1 },
    }));
  };
  const setQty = (variantId: string, qty: number) =>
    setCart((prev) => ({ ...prev, [variantId]: { ...prev[variantId], qty: Math.max(1, qty) } }));
  const removeLine = (variantId: string) =>
    setCart((prev) => {
      const next = { ...prev };
      delete next[variantId];
      return next;
    });

  const results = search.trim()
    ? data.items
        .filter((i) => {
          const q = search.toLowerCase();
          return (i.sku ?? "").toLowerCase().includes(q) || i.title.toLowerCase().includes(q);
        })
        .slice(0, 6)
    : [];

  const createError = create.data && "kind" in create.data && create.data.kind === "error" ? create.data.error : null;
  const createMsg = create.data && "kind" in create.data && create.data.kind === "created" ? create.data.message : null;
  // Clear the builder after a successful save.
  const lastSavedRef = useRef<unknown>(null);
  if (createMsg && create.data !== lastSavedRef.current) {
    lastSavedRef.current = create.data;
    setTimeout(() => {
      setCart({});
      setLabel("");
    }, 0);
  }

  const capReached = data.shortcutCap !== null && data.used >= data.shortcutCap;

  return (
    <section className="portal-card">
      <h1>One-tap reorder</h1>
      <p className="muted">
        Save your usual orders as shortcuts, then reorder any of them in a single
        tap — especially handy from the installed app on your phone.
      </p>

      {/* Saved shortcuts */}
      <h2 className="portal-subhead">Your shortcuts</h2>
      {data.shortcuts.length === 0 ? (
        <p className="muted">
          No shortcuts yet. Build one below from the items you order most.
        </p>
      ) : (
        <ul className="quote-list">
          {data.shortcuts.map((s) => (
            <li key={s.id} className="quote-list-row">
              <span>
                <strong>{s.label}</strong>
                <span className="muted"> · {s.itemCount} item{s.itemCount === 1 ? "" : "s"}</span>
              </span>
              <span className="portal-actions">
                <del.Form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="intent" value="reorder" />
                  <input type="hidden" name="shortcutId" value={s.id} />
                  <button type="submit" className="portal-button" disabled={del.state !== "idle"}>
                    Reorder now
                  </button>
                </del.Form>
                <del.Form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="shortcutId" value={s.id} />
                  <button type="submit" className="portal-link-button">
                    Delete
                  </button>
                </del.Form>
              </span>
            </li>
          ))}
        </ul>
      )}
      {del.data && "kind" in del.data && del.data.kind === "error" && (
        <p className="error" role="alert">{del.data.error}</p>
      )}

      {/* Build a new shortcut */}
      <h2 className="portal-subhead">Save a new shortcut</h2>
      {data.catalogError ? (
        <p className="error">We couldn’t load your catalog right now. Please refresh.</p>
      ) : capReached ? (
        <p className="muted">{shortcutCapMessage(data.shortcutCap!)}</p>
      ) : (
        <>
          <label className="field-label" htmlFor="sc-search">Add an item</label>
          <input
            id="sc-search"
            ref={searchRef}
            className="quick-order-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                e.preventDefault();
                addToCart(results[0].variantId);
                setSearch("");
                searchRef.current?.focus();
              }
            }}
            placeholder="Type a SKU or product name, then Enter"
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
                      addToCart(r.variantId);
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

          {cartLines.length > 0 && (
            <>
              <ul className="catalog-list">
                {cartLines.map((l) => (
                  <li key={l.variantId} className="catalog-row">
                    <div className="catalog-info">
                      <span className="catalog-title">{l.title}</span>
                      {l.sku && <span className="muted"> · {l.sku}</span>}
                    </div>
                    <label className="catalog-qty">
                      <span className="visually-hidden">Quantity for {l.title}</span>
                      <input
                        type="number"
                        min={1}
                        value={String(l.qty)}
                        onChange={(e) => setQty(l.variantId, Number(e.target.value) || 1)}
                      />
                    </label>
                    <button type="button" className="portal-link-button" onClick={() => removeLine(l.variantId)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <label className="field-label" htmlFor="sc-label">Name this shortcut</label>
              <div className="portal-actions">
                <input
                  id="sc-label"
                  className="quick-order-input"
                  style={{ maxWidth: "16rem", marginBottom: 0 }}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Monthly reorder"
                />
                <button
                  type="button"
                  className="portal-button"
                  disabled={create.state !== "idle"}
                  onClick={() =>
                    create.submit(
                      {
                        intent: "create",
                        label,
                        lines: JSON.stringify(cartLines.map((l) => ({ variantId: l.variantId, quantity: l.qty }))),
                      },
                      { method: "post" },
                    )
                  }
                >
                  Save shortcut
                </button>
              </div>
            </>
          )}
          {createError && <p className="error" role="alert">{createError}</p>}
          {createMsg && <p className="muted">{createMsg}</p>}
        </>
      )}

      {/* Push reminders (Growth, opt-in) */}
      <h2 className="portal-subhead">Reorder reminders</h2>
      {data.pushAllowed ? (
        data.vapidPublicKey ? (
          <PushOptIn vapidKey={data.vapidPublicKey} />
        ) : (
          <p className="muted">
            Reorder reminders will be available here soon. We’ll only ever send them
            if you turn them on.
          </p>
        )
      ) : (
        <p className="muted">
          Push reorder reminders are part of the store’s Growth plan.
        </p>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        <Link to="/portal" className="portal-link">← Back to portal</Link>
      </p>
    </section>
  );
}

/**
 * Opt-in push toggle. Strictly progressive: renders nothing actionable when the
 * browser lacks Push/Notification support, and only asks for permission when the
 * buyer clicks "Turn on" (never on load).
 */
function PushOptIn({ vapidKey }: { vapidKey: string }) {
  const [status, setStatus] = useState<"idle" | "on" | "off" | "error" | "unsupported">("idle");
  const [busy, setBusy] = useState(false);

  const subscribe = async () => {
    setBusy(true);
    try {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("unsupported");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch("/portal/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setStatus(res.ok ? "on" : "error");
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="muted">
        Get a gentle nudge when it’s time to reorder. Off by default — turn it on
        only if you want it.
      </p>
      <button type="button" className="portal-button" onClick={subscribe} disabled={busy}>
        {busy ? "Setting up…" : "Turn on reorder reminders"}
      </button>
      {status === "on" && <p className="muted">Reminders are on. You can turn them off in your browser any time.</p>}
      {status === "off" && <p className="muted">No problem — reminders stay off.</p>}
      {status === "unsupported" && <p className="muted">This browser doesn’t support reminders. Install the app to enable them.</p>}
      {status === "error" && <p className="error">We couldn’t turn reminders on. Please try again.</p>}
    </div>
  );
}

// Convert a base64url VAPID key to the Uint8Array the Push API expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
