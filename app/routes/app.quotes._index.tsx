import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link as RemixLink, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Text,
  EmptyState,
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listQuotesForShop } from "../services/quote-inbox.server";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate } from "../lib/format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quotes = await listQuotesForShop(session.shop);
  return { quotes };
};

export default function QuotesInbox() {
  const { quotes } = useLoaderData<typeof loader>();

  const rows = quotes.map((quote, index) => {
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
    <Page>
      <TitleBar title="Quotes" />
      <Card padding="0">
        {quotes.length === 0 ? (
          <EmptyState
            heading="No quotes yet"
            action={{ content: "Invite buyers", url: "/app/buyers" }}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              When a buyer sends a quote request it lands here. Send your buyers
              a secure sign-in link to get started.
            </p>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={{ singular: "quote", plural: "quotes" }}
            itemCount={quotes.length}
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
      </Card>
    </Page>
  );
}

// Keep merchant-facing errors as a friendly page, not a raw stack trace.
export function ErrorBoundary() {
  return (
    <Page>
      <TitleBar title="Quotes" />
      <Card>
        <RemixLink to="/app/quotes">
          Something went wrong loading your quotes. Try again.
        </RemixLink>
      </Card>
    </Page>
  );
}
