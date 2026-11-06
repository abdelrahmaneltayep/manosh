import type { LoaderFunctionArgs } from "@remix-run/node";
import { useEffect, useState } from "react";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Banner,
  BlockStack,
  Box,
  Tabs,
  Text,
  TextField,
  EmptyState,
  Pagination,
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { SectionTabs } from "../components/SectionTabs";
import { listQuotesForShop } from "../services/quote-inbox.server";
import { canCreateQuote } from "../services/plan-limits.server";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate } from "../lib/format";
import { QUOTE_OPS_ENABLED } from "../lib/quote-ops";
import { upgradeUrl } from "../lib/upgrade";
import { isGrowthTier } from "../lib/billing";
import { QUOTE_VIEWS, filterQuotes, paginate, viewById, viewCounts } from "../lib/quote-views";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quotes = await listQuotesForShop(session.shop);

  // Quote-volume usage, for the soft near-cap banner (display only).
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: true },
  });
  const allowance = shop ? await canCreateQuote(shop.id) : null;
  const usage =
    allowance && Number.isFinite(allowance.cap)
      ? { used: allowance.used, cap: allowance.cap }
      : null;

  // Bulk import is Growth+; only offer it where it works (no paywall from a header action).
  return { quotes, usage, quoteOpsEnabled: QUOTE_OPS_ENABLED() && isGrowthTier(shop?.plan) };
};

export default function QuotesInbox() {
  const { quotes, usage, quoteOpsEnabled } = useLoaderData<typeof loader>();
  const atCap = usage && usage.used >= usage.cap;
  const nearCap = usage && usage.used >= usage.cap * 0.8;

  // View, search and page live in the URL so Back, deep links from Home and
  // bookmarks restore exactly what the merchant was looking at.
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const view = viewById(params.get("view"));
  const query = params.get("q") ?? "";
  const [search, setSearch] = useState(query);
  useEffect(() => setSearch(query), [query]);
  const go = (next: { view?: string; q?: string; page?: number }) => {
    const p = new URLSearchParams(params);
    const v = next.view ?? view.id;
    if (v === "all") p.delete("view");
    else p.set("view", v);
    const qq = next.q ?? query;
    if (qq) p.set("q", qq);
    else p.delete("q");
    if (next.page && next.page > 1) p.set("page", String(next.page));
    else p.delete("page");
    const qs = p.toString();
    navigate(qs ? `?${qs}` : ".", { replace: next.q !== undefined && next.view === undefined });
  };
  // Debounced search → URL (replace, so typing doesn't flood history).
  useEffect(() => {
    if (search === query) return;
    const t = setTimeout(() => go({ q: search }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const counts = viewCounts(quotes);
  const filtered = filterQuotes(quotes, view.id, query);
  const pageInfo = paginate(filtered, Number(params.get("page") ?? 1));
  const tabs = QUOTE_VIEWS.map((v) => ({
    id: `view-${v.id}`,
    content: v.label,
    badge: v.id === "all" ? undefined : String(counts[v.id] ?? 0),
    accessibilityLabel: `${v.label}, ${counts[v.id] ?? 0} quotes`,
    panelID: "quotes-panel",
  }));

  const rows = pageInfo.rows.map((quote, index) => {
    const badge = quoteStatusBadge(quote.displayStatus);
    return (
      <IndexTable.Row id={quote.id} key={quote.id} position={index}>
        <IndexTable.Cell>
          <PolarisLink url={`/app/quotes/${quote.id}`} removeUnderline>
            <Text as="span" fontWeight="semibold">
              {quote.companyName}
            </Text>
          </PolarisLink>
        </IndexTable.Cell>
        <IndexTable.Cell>{quote.buyerEmail}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" alignment="end" numeric>
            {quote.lineCount}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{formatDate(quote.createdAt)}</IndexTable.Cell>
        <IndexTable.Cell>{formatDate(quote.expiresAt)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      fullWidth={false}
      primaryAction={quoteOpsEnabled ? { content: "Import quotes", url: "/app/quotes/import" } : undefined}
    >
      <TitleBar title="Quotes" />
      <SectionTabs active="quotes" />
      <BlockStack gap="400">
        {usage && nearCap && (
          <Banner
            tone={atCap ? "critical" : "warning"}
            title={`${usage.used} / ${usage.cap} active quotes this month`}
            action={{ content: "See plans", url: upgradeUrl("starter") }}
          >
            <p>
              {atCap
                ? "You’ve reached the Free plan limit. Buyers can’t submit new quotes until some expire or are ordered. Starter and above have unlimited quotes."
                : "You’re close to the Free plan limit of active quotes. Starter and above have unlimited quotes."}
            </p>
          </Banner>
        )}
        <Card padding="0">
          {quotes.length === 0 ? (
            <EmptyState
              heading="No quotes yet"
              action={{ content: "Invite buyers", url: "/app/buyers" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                When a buyer asks for a quote it lands here. Send your buyers a secure sign-in
                link to get started.
              </p>
            </EmptyState>
          ) : (
            <>
              <Tabs tabs={tabs} selected={QUOTE_VIEWS.findIndex((v) => v.id === view.id)} onSelect={(i) => go({ view: QUOTE_VIEWS[i].id, page: 1 })} />
              <Box padding="300">
                <TextField
                  label="Search quotes"
                  labelHidden
                  placeholder="Search by company or buyer email"
                  value={search}
                  onChange={setSearch}
                  clearButton
                  onClearButtonClick={() => setSearch("")}
                  autoComplete="off"
                />
              </Box>
              <div id="quotes-panel" role="tabpanel" aria-label={`${view.label} quotes`}>
                {filtered.length === 0 ? (
                  <Box padding="600">
                    <BlockStack gap="200" inlineAlign="center">
                      <Text as="p" fontWeight="semibold">
                        {query ? "No quotes match your search" : `No ${view.label.toLowerCase()} quotes`}
                      </Text>
                      <Text as="p" tone="subdued">
                        {query ? "Try a different company name or email." : "Quotes show up here when they reach this status."}
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "quote", plural: "quotes" }}
                    itemCount={pageInfo.rows.length}
                    selectable={false}
                    headings={[
                      { title: "Company" },
                      { title: "Buyer" },
                      { title: "Lines", alignment: "end" },
                      { title: "Received" },
                      { title: "Expires" },
                      { title: "Status" },
                    ]}
                  >
                    {rows}
                  </IndexTable>
                )}
              </div>
              {pageInfo.pages > 1 && (
                <Box padding="300">
                  <Pagination
                    hasPrevious={pageInfo.hasPrev}
                    hasNext={pageInfo.hasNext}
                    onPrevious={() => go({ page: pageInfo.page - 1 })}
                    onNext={() => go({ page: pageInfo.page + 1 })}
                    label={`Page ${pageInfo.page} of ${pageInfo.pages}`}
                  />
                </Box>
              )}
            </>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

// Keep merchant-facing errors as a friendly page, not a raw stack trace.
export function ErrorBoundary() {
  return (
    <Page>
      <TitleBar title="Quotes" />
      <Banner tone="critical" title="We couldn’t load your quotes" action={{ content: "Try again", url: "/app/quotes" }}>
        <p>Your quotes are safe. Reload the page, and if this keeps happening contact Mannon support.</p>
      </Banner>
    </Page>
  );
}
