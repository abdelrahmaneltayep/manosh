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
import { DisclosureCard } from "../components/DisclosureCard";
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
import { upgradeUrl } from "../lib/upgrade";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_PRICELISTS === "true";
const NAME_FIELD_ID = "price-list-name";

/** Move focus to the create form's first field (EmptyState action). */
function focusField(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.focus();
}

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
  const firstRun = data.lists.length === 0;

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

        {/* 1. The list the merchant works in (with plan usage) */}
        <Card padding="0">
          <Box padding="400">
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
              {!data.allowance.allowed && (
                <Banner
                  tone="warning"
                  title="Price-list limit reached"
                  action={{ content: "Upgrade to Growth", url: upgradeUrl("growth") }}
                >
                  <p>{data.capMessage}</p>
                </Banner>
              )}
            </BlockStack>
          </Box>
          {firstRun ? (
            <EmptyState
              heading="No price lists yet"
              action={
                data.allowance.allowed
                  ? { content: "Create price list", onAction: () => focusField(NAME_FIELD_ID) }
                  : { content: "Upgrade to Growth", url: upgradeUrl("growth") }
              }
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Buyers see your regular prices until you assign them a price list. Create one,
                add prices, then assign it to a company.
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
                { title: "Prices" },
                { title: "Volume breaks" },
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

        {/* 2. Create */}
        {data.allowance.allowed && (
          <Card>
            <Form method="post">
              <input type="hidden" name="currency" value="USD" />
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Create a price list
                </Text>
                <TextField
                  id={NAME_FIELD_ID}
                  label="Name"
                  name="name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                  placeholder="e.g. Wholesale tier A"
                  helpText="You add prices and companies on the next screen."
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

        {/* 3. Explanation, one click away (open on first run) */}
        <DisclosureCard
          title="How price lists work"
          subtitle="Set per-customer prices so buyers see the right price, with no discount codes."
          defaultOpen={firstRun}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              A price list holds a price for each product variant. Assign it to a company and that
              company’s buyers see those prices in the portal and on their quotes.
            </Text>
            <Text as="p" variant="bodyMd">
              On Growth you can also add volume breaks (a lower price from a set quantity), import
              prices from a CSV file, and apply a list automatically by customer tag.
            </Text>
          </BlockStack>
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
