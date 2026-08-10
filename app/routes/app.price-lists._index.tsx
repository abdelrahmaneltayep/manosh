import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Button,
  Box,
  TextField,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import {
  getPlanLimits,
  evaluatePriceListAllowance,
  priceListCapMessage,
  GROWTH_PLAN,
} from "../lib/billing";
import {
  listPriceListsForShop,
  createPriceList,
  PriceListCapError,
} from "../services/price-list.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_PRICELISTS === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const enabled = ENABLED();
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const cap = getPlanLimits(status.plan).priceListCap;

  const lists = enabled ? await listPriceListsForShop(session.shop) : [];
  const allowance = evaluatePriceListAllowance(lists.length, cap);

  return {
    enabled,
    isGrowth: status.plan === GROWTH_PLAN,
    lists,
    allowance: {
      allowed: allowance.allowed,
      used: allowance.used,
      cap: Number.isFinite(allowance.cap) ? allowance.cap : null,
    },
    capMessage: priceListCapMessage(Number.isFinite(cap) ? cap : 3),
  };
};

type ActionResult = { ok: false; error: string } | never;

export const action = async ({ request }: ActionFunctionArgs): Promise<Response | ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const cap = getPlanLimits(status.plan).priceListCap;

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const currency = String(form.get("currency") ?? "USD").trim() || "USD";
  if (!name) return { ok: false, error: "Give the price list a name." };

  try {
    const created = await createPriceList(session.shop, { name, currency }, cap);
    return redirect(`/app/price-lists/${created.id}`);
  } catch (error) {
    if (error instanceof PriceListCapError) {
      return { ok: false, error: priceListCapMessage(error.cap) };
    }
    throw error;
  }
};

export default function PriceLists() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [name, setName] = useState("");

  const error = actionData && "ok" in actionData && !actionData.ok ? actionData.error : null;

  return (
    <Page>
      <TitleBar title="Price lists" />
      <SectionTabs active="price-lists" />
      <BlockStack gap="500">
        {error && (
          <Banner tone="warning" title="Couldn’t create the list">
            <p>{error}</p>
          </Banner>
        )}

        {/* Usage / cap */}
        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Your price lists
              </Text>
              <Badge tone={data.allowance.allowed ? undefined : "attention"}>
                {data.allowance.cap === null
                  ? `${data.allowance.used} · unlimited`
                  : `${data.allowance.used} / ${data.allowance.cap} used`}
              </Badge>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              Assign per-customer prices and volume breaks so buyers see the right
              price — no discount codes. Volume breaks and CSV import are Growth.
            </Text>
            {!data.allowance.allowed && (
              <Banner tone="warning" title="Price-list limit reached">
                <p>{data.capMessage}</p>
                <Box paddingBlockStart="200">
                  <Button url="/app/settings" variant="primary">
                    Upgrade to Growth
                  </Button>
                </Box>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* Create */}
        {data.allowance.allowed && (
          <Card>
            <Form method="post">
              <input type="hidden" name="currency" value="USD" />
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  New price list
                </Text>
                <TextField
                  label="Name"
                  name="name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                  placeholder="e.g. Wholesale tier A"
                />
                <InlineStack>
                  <Button variant="primary" submit loading={submitting}>
                    Create price list
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        )}

        {/* List / empty state */}
        <Card padding="0">
          {data.lists.length === 0 ? (
            <EmptyState
              heading="Create your first price list"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                A price list holds per-variant prices (and volume breaks on Growth).
                Assign it to a company and its buyers see those prices in the portal
                and on quotes.
              </p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "price list", plural: "price lists" }}
              itemCount={data.lists.length}
              selectable={false}
              headings={[
                { title: "Name" },
                { title: "Currency" },
                { title: "Entries" },
                { title: "Breaks" },
                { title: "Companies" },
              ]}
            >
              {data.lists.map((l, index) => (
                <IndexTable.Row id={l.id} key={l.id} position={index}>
                  <IndexTable.Cell>
                    <Link to={`/app/price-lists/${l.id}`}>{l.name}</Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{l.currency}</IndexTable.Cell>
                  <IndexTable.Cell>{l.entryCount}</IndexTable.Cell>
                  <IndexTable.Cell>{l.breakCount}</IndexTable.Cell>
                  <IndexTable.Cell>{l.companyCount}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
