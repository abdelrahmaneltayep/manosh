/*
 * F25.5 — Customer Account UI extension: the buyer's Mannon quotes, shown natively
 * inside Shopify's new customer account. Read-only list + status; actions
 * (reorder / request a similar quote) deep-link to the magic-link portal.
 *
 * NOTE: this extension builds with the Shopify CLI against
 * `@shopify/ui-extensions-react/customer-account` (installed per-extension), not
 * the app's Vite/tsc pipeline — it's excluded from the root tsconfig. Verify the
 * exact component prop names against the installed ui-extensions version when you
 * run `shopify app dev`.
 */
import { useEffect, useState } from "react";
import {
  reactExtension,
  BlockStack,
  InlineStack,
  Card,
  Text,
  Badge,
  Button,
  Banner,
  Spinner,
  useApi,
} from "@shopify/ui-extensions-react/customer-account";

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

export default reactExtension("customer-account.order-index.block.render", () => <QuotesBlock />);

function QuotesBlock() {
  // `authenticatedAccount.customer` gives the logged-in buyer; `sessionToken` signs
  // the request so the Mannon backend can trust it.
  const { sessionToken, authenticatedAccount } = useApi<"customer-account.order-index.block.render">();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [portalBase, setPortalBase] = useState("");
  const [quotes, setQuotes] = useState<AccountQuote[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const customer = await authenticatedAccount.customer;
        const email = (customer && "email" in customer ? (customer as { email?: string }).email : "") ?? "";
        const token = await sessionToken.get();
        const res = await fetch(`${APP_URL}/api/account/quotes?email=${encodeURIComponent(email)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!alive) return;
        setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
        setPortalBase(String(data.portalBase ?? ""));
        setEnabled(Boolean(data.enabled));
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [authenticatedAccount, sessionToken]);

  if (loading) return <Spinner accessibilityLabel="Loading your quotes" />;
  if (error) return <Banner status="critical">We couldn’t load your quotes right now.</Banner>;
  if (!enabled) return null; // feature off / not a paid plan → render nothing

  return (
    <Card padding>
      <BlockStack spacing="loose">
        <Text emphasis="bold">Your quotes</Text>
        {quotes.length === 0 ? (
          <Text appearance="subdued">You don’t have any quotes yet.</Text>
        ) : (
          quotes.map((q) => (
            <InlineStack key={q.id} blockAlignment="center" spacing="base">
              <BlockStack spacing="none">
                <Text>
                  {q.itemCount} item{q.itemCount === 1 ? "" : "s"} · {q.displayCurrency ? `${q.displayCurrency} ` : ""}
                  {q.estimatedTotal.toFixed(2)}
                </Text>
                <Text appearance="subdued" size="small">{new Date(q.createdAt).toLocaleDateString()}</Text>
              </BlockStack>
              <Badge>{q.status.toLowerCase()}</Badge>
              <Button kind="secondary" to={portalBase || APP_URL}>
                {q.reorderable ? "Reorder" : "Request similar"}
              </Button>
            </InlineStack>
          ))
        )}
      </BlockStack>
    </Card>
  );
}
