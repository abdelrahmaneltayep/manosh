/** @jsxImportSource preact */
/*
 * F25.5 — Customer Account UI extension: the buyer's Mannon quotes, shown natively
 * inside Shopify's customer account. Read-only list + status; actions (reorder /
 * request a similar quote) deep-link to the magic-link portal.
 *
 * API 2026-07 · Preact + Polaris web components (the React component set ended
 * with 2025-07). Identity comes from the customer-account session token only:
 * the backend resolves the buyer from the token's subject, so nothing
 * client-supplied is trusted (see app/routes/api.account.quotes.tsx).
 *
 * Built by the Shopify CLI, not the app's Vite/tsc pipeline (excluded from the
 * root tsconfig). `npm run typecheck` inside this folder type-checks it.
 */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useSessionToken } from "@shopify/ui-extensions/customer-account/preact";

// The Mannon app host. Set to your deployed app URL.
const APP_URL = "https://manosh.fly.dev";

interface AccountQuote {
  id: string;
  status: string;
  source: string;
  createdAt: string;
  itemCount: number;
  estimatedTotal: number;
  displayCurrency: string | null;
  reorderable: boolean;
}

export default async () => {
  render(<QuotesBlock />, document.body);
};

function QuotesBlock() {
  const sessionToken = useSessionToken();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [portalBase, setPortalBase] = useState("");
  const [quotes, setQuotes] = useState<AccountQuote[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The session token proves which logged-in customer this is; the
        // backend derives the email from it. No email is sent from the client.
        const token = await sessionToken.get();
        const res = await fetch(`${APP_URL}/api/account/quotes`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { quotes?: unknown; portalBase?: unknown; enabled?: unknown };
        if (!alive) return;
        setQuotes(Array.isArray(data.quotes) ? (data.quotes as AccountQuote[]) : []);
        setPortalBase(String(data.portalBase ?? ""));
        setEnabled(Boolean(data.enabled));
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionToken]);

  if (loading) return <s-spinner accessibilityLabel="Loading your quotes" />;
  if (error) return <s-banner tone="critical">We couldn’t load your quotes right now.</s-banner>;
  if (!enabled) return null; // feature off / not a paid plan → render nothing

  return (
    <s-section heading="Your quotes">
      <s-stack gap="base">
        {quotes.length === 0 ? (
          <s-text color="subdued">You don’t have any quotes yet.</s-text>
        ) : (
          quotes.map((q) => (
            <s-stack key={q.id} direction="inline" gap="base" alignItems="center">
              <s-stack gap="none">
                <s-text>
                  {q.itemCount} item{q.itemCount === 1 ? "" : "s"} · {q.displayCurrency ? `${q.displayCurrency} ` : ""}
                  {q.estimatedTotal.toFixed(2)}
                </s-text>
                <s-text color="subdued">{new Date(q.createdAt).toLocaleDateString()}</s-text>
              </s-stack>
              <s-badge>{q.status.toLowerCase()}</s-badge>
              <s-button variant="secondary" href={portalBase || APP_URL}>
                {q.reorderable ? "Reorder" : "Request similar"}
              </s-button>
            </s-stack>
          ))
        )}
      </s-stack>
    </s-section>
  );
}
