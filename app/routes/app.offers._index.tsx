import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link as RemixLink } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box,
  IndexTable, EmptyState, Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { getShopCapabilities } from "../services/billing.server";
import { GROWTH_PLAN } from "../lib/billing";
import { MAKE_AN_OFFER_ENABLED, listOffers } from "../services/offers.server";
import { formatDate } from "../lib/format";
import type { OfferStatus } from "@prisma/client";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  const locked = caps.makeAnOffer === "teaser"; // free/starter
  const offers = locked ? [] : await listOffers(session.shop);
  return { locked, tier: caps.makeAnOffer, offers };
};

const STATUS_TONE: Record<OfferStatus, "success" | "attention" | "critical" | "info" | undefined> = {
  PENDING: "attention", COUNTERED: "info", ACCEPTED: "success", DECLINED: undefined, EXPIRED: undefined, CONVERTED: "success",
};

export default function OffersQueue() {
  const { locked, tier, offers } = useLoaderData<typeof loader>();

  if (locked) {
    return (
      <Page>
        <TitleBar title="Offers" />
        <SectionTabs active="offers" />
        <Banner tone="info" title="Make an Offer — let buyers name their price">
          <p>
            Turn browsers into buyers: accept, counter, or auto-handle price offers with margin-safe
            rules. Available on Growth (manual + rules) and Scale (automation + pay-what-you-want).
          </p>
          <Box paddingBlockStart="200">
            <Button url={`/app/settings?upgrade=${GROWTH_PLAN}`} variant="primary">See Growth</Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Offers" />
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" tone="subdued" variant="bodyMd">
            Buyer price offers. Counter, accept, or decline — margin-safe.{" "}
            {tier === "manual" && <Badge tone="info">Growth · manual + rules</Badge>}
            {tier === "auto" && <Badge tone="success">Scale · automation + PWYW</Badge>}
          </Text>
          <InlineStack gap="200">
            <Button url="/app/offers/rules">Rules</Button>
            <Button url="/app/offers/widget">Widget</Button>
          </InlineStack>
        </InlineStack>

        <Card padding="0">
          {offers.length === 0 ? (
            <Box padding="400">
              <EmptyState heading="No offers yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Once the Make-an-Offer widget is live on your storefront, buyer offers land here.</p>
              </EmptyState>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "offer", plural: "offers" }}
              itemCount={offers.length}
              selectable={false}
              headings={[{ title: "Buyer" }, { title: "Source" }, { title: "List" }, { title: "Offer" }, { title: "Margin" }, { title: "Status" }, { title: "Received" }]}
            >
              {offers.map((o, i) => (
                <IndexTable.Row id={o.id} key={o.id} position={i}>
                  <IndexTable.Cell>
                    <PolarisLink url={`/app/offers/${o.id}`} removeUnderline>{o.buyerEmail}</PolarisLink>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{o.source.toLowerCase()}</IndexTable.Cell>
                  <IndexTable.Cell>{o.listPriceTotal.toFixed(2)}</IndexTable.Cell>
                  <IndexTable.Cell>{o.offeredTotal.toFixed(2)}{o.currentCounterTotal != null && <Text as="span" tone="subdued"> → {o.currentCounterTotal.toFixed(2)}</Text>}</IndexTable.Cell>
                  <IndexTable.Cell>{o.marginAtOffer == null ? "—" : `${Math.round(o.marginAtOffer * 100)}%`}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={STATUS_TONE[o.status]}>{o.status.charAt(0) + o.status.slice(1).toLowerCase()}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>{formatDate(o.createdAt)}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
