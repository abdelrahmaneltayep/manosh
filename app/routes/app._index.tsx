import type { LoaderFunctionArgs, SerializeFrom } from "@remix-run/node";
import { Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineGrid,
  InlineStack,
  Box,
  Divider,
  EmptyState,
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getDashboardMetrics } from "../services/dashboard.server";
import { EXPIRING_SOON_DAYS } from "../lib/dashboard";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate, formatDuration, formatMoney } from "../lib/format";

// Metrics as they arrive on the client (Dates serialized to strings by Remix).
type Metrics = NonNullable<SerializeFrom<typeof loader>["metrics"]>;

// F5 — ROI dashboard. Built entirely from the append-only Event stream (counts,
// timings) plus the money snapshots Shopify returned (revenue). Read-only: the
// dashboard never writes and never computes money.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });
  const metrics = shop ? await getDashboardMetrics(shop.id) : null;
  return { metrics };
};

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

function HeadlineCard({ metrics }: { metrics: Metrics }) {
  const primary = metrics.revenue[0] ?? null;
  const others = metrics.revenue.slice(1);
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingSm" tone="subdued">
          Revenue Mannon made for you
        </Text>
        {primary ? (
          <Text as="p" variant="heading3xl">
            {formatMoney(primary.amount, primary.currencyCode)}
          </Text>
        ) : (
          <Text as="p" variant="heading3xl">
            —
          </Text>
        )}
        {others.length > 0 && (
          <Text as="p" variant="bodyMd" tone="subdued">
            plus{" "}
            {others
              .map((r) => formatMoney(r.amount, r.currencyCode))
              .join(", ")}
          </Text>
        )}
        <Text as="p" variant="bodyMd" tone="subdued">
          {metrics.ordersCount > 0
            ? `Across ${metrics.ordersCount} order${metrics.ordersCount === 1 ? "" : "s"} sent to Shopify from accepted quotes.`
            : "Your first accepted quote turns into an order here — Shopify calculates every total."}
        </Text>
      </BlockStack>
    </Card>
  );
}

function ExpiringSoonCard({ metrics }: { metrics: Metrics }) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Expiring in the next {EXPIRING_SOON_DAYS} days
        </Text>
        {metrics.expiringSoon.length === 0 ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            Nothing about to lapse — you&rsquo;re on top of your open quotes.
          </Text>
        ) : (
          <BlockStack gap="0">
            {metrics.expiringSoon.map((quote, index) => {
              const badge = quoteStatusBadge(quote.status);
              return (
                <Box key={quote.id}>
                  {index > 0 && <Divider />}
                  <Box paddingBlock="300">
                    <InlineStack align="space-between" blockAlign="center" gap="200">
                      <PolarisLink url={`/app/quotes/${quote.id}`} removeUnderline>
                        <Text as="span" fontWeight="semibold">
                          {quote.companyName}
                        </Text>
                      </PolarisLink>
                      <InlineStack gap="300" blockAlign="center">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        <Text as="span" variant="bodySm" tone="subdued">
                          Expires {formatDate(quote.expiresAt)}
                        </Text>
                      </InlineStack>
                    </InlineStack>
                  </Box>
                </Box>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Index() {
  const { metrics } = useLoaderData<typeof loader>();

  // Empty state: no shop row yet, or no activity recorded.
  if (!metrics || !metrics.hasActivity) {
    return (
      <Page>
        <TitleBar title="Mannon" />
        <Card>
          <EmptyState
            heading="Your revenue dashboard is ready"
            action={{ content: "Invite buyers", url: "/app/buyers" }}
            secondaryAction={{ content: "Review settings", url: "/app/settings" }}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              As buyers request quotes and reorder, this page fills with the
              revenue Mannon made for you, how fast you&rsquo;re quoting, and the
              quotes that need attention. Send your buyers a secure sign-in link
              to get started.
            </p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Mannon" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              <HeadlineCard metrics={metrics} />
              <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                <MetricTile label="Quotes sent" value={String(metrics.quotesSent)} />
                <MetricTile label="Quotes accepted" value={String(metrics.quotesAccepted)} />
                <MetricTile label="Reorders" value={String(metrics.reorders)} />
                <MetricTile
                  label="Median time to quote"
                  value={
                    metrics.medianTimeToQuoteMs === null
                      ? "—"
                      : formatDuration(metrics.medianTimeToQuoteMs)
                  }
                />
              </InlineGrid>
              <ExpiringSoonCard metrics={metrics} />
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

// Merchant-facing errors stay a friendly page, never a raw stack trace.
export function ErrorBoundary() {
  return (
    <Page>
      <TitleBar title="Mannon" />
      <Card>
        <RemixLink to="/app">
          Something went wrong loading your dashboard. Try again.
        </RemixLink>
      </Card>
    </Page>
  );
}
