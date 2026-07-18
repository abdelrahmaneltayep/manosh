import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Button,
  Banner,
  BlockStack,
  EmptyState,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { issueMagicLink } from "../services/magic-link.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const buyers = await prisma.buyer.findMany({
    where: { company: { shop: { shopifyDomain: session.shop } } },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    buyers: buyers.map((b) => ({
      id: b.id,
      email: b.email,
      name: b.name,
      company: b.company.name,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const buyerId = String(form.get("buyerId") ?? "");

  // Only issue links for buyers under the authenticated shop.
  const buyer = await prisma.buyer.findFirst({
    where: { id: buyerId, company: { shop: { shopifyDomain: session.shop } } },
  });
  if (!buyer) {
    return { error: "That buyer could not be found." };
  }

  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const { url, expiresAt } = await issueMagicLink(buyer.id, { baseUrl });
  return { url, email: buyer.email, expiresAt: expiresAt.toISOString() };
};

export default function BuyersPage() {
  const { buyers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [copied, setCopied] = useState(false);

  const generatedUrl = fetcher.data && "url" in fetcher.data ? fetcher.data.url : null;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  useEffect(() => {
    if (generatedUrl) {
      setCopied(false);
      shopify.toast.show("Magic link generated");
    }
  }, [generatedUrl, shopify]);

  const resourceName = { singular: "buyer", plural: "buyers" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(buyers);

  const rows = buyers.map((buyer, index) => (
    <IndexTable.Row
      id={buyer.id}
      key={buyer.id}
      position={index}
      selected={selectedResources.includes(buyer.id)}
    >
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {buyer.name ?? "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{buyer.email}</IndexTable.Cell>
      <IndexTable.Cell>{buyer.company}</IndexTable.Cell>
      <IndexTable.Cell>
        <fetcher.Form method="post">
          <input type="hidden" name="buyerId" value={buyer.id} />
          <Button
            submit
            loading={
              fetcher.state !== "idle" &&
              fetcher.formData?.get("buyerId") === buyer.id
            }
          >
            Generate link
          </Button>
        </fetcher.Form>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Buyers" />
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" title="Couldn’t generate a link">
            <p>{error}</p>
          </Banner>
        )}
        {generatedUrl && (
          <Banner
            tone="success"
            title="Magic link ready to send"
            onDismiss={() => fetcher.load("/app/buyers")}
          >
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Copy this link and email it to the buyer. It expires
                automatically and can be used once.
              </Text>
              <Text as="p" variant="bodyMd" breakWord>
                <code>{generatedUrl}</code>
              </Text>
              <div>
                <Button
                  onClick={async () => {
                    await navigator.clipboard?.writeText(generatedUrl);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            </BlockStack>
          </Banner>
        )}

        <Card padding="0">
          {buyers.length === 0 ? (
            <EmptyState
              heading="No buyers yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Buyers appear here once they belong to a B2B company on your
                store. Then you can send each one a secure sign-in link.
              </p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={buyers.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              selectable={false}
              headings={[
                { title: "Name" },
                { title: "Email" },
                { title: "Company" },
                { title: "Magic link" },
              ]}
            >
              {rows}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
