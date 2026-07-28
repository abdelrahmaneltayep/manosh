import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { flexPayAllowed, GROWTH_PLAN } from "../lib/billing";
import { listPlansForShop, listEligibleOrders, getDefaultDepositPct, setDefaultDepositPct } from "../services/payments.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_FLEX_PAY === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = flexPayAllowed(status.plan);
  if (!isGrowth) return { isGrowth, plans: [], eligible: [], overdueOnly: false, defaultDepositPct: null };

  const overdueOnly = new URL(request.url).searchParams.get("filter") === "overdue";
  const [plans, eligible, defaultDepositPct] = await Promise.all([
    listPlansForShop(session.shop, { overdueOnly }),
    listEligibleOrders(session.shop),
    getDefaultDepositPct(session.shop),
  ]);
  return { isGrowth, plans, eligible, overdueOnly, defaultDepositPct };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!flexPayAllowed(status.plan)) return { ok: false, error: "Flexible payments are a Growth feature." };

  const form = await request.formData();
  if (String(form.get("intent")) === "default-deposit") {
    const raw = String(form.get("depositPct") ?? "").trim();
    const pct = raw === "" ? null : Math.min(Math.max(Number(raw) / 100, 0), 1);
    if (pct != null && !Number.isFinite(pct)) return { ok: false, error: "Enter a number between 0 and 100." };
    await setDefaultDepositPct(session.shop, pct);
    return { ok: true, message: "Default deposit policy saved." };
  }
  return { ok: false, error: "Unknown action." };
};

const STATUS_TONE: Record<string, "success" | "attention" | "critical"> = {
  COMPLETED: "success",
  ACTIVE: "attention",
  OVERDUE: "critical",
};

export default function Payments() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [deposit, setDeposit] = useState(data.defaultDepositPct != null ? String(Math.round(data.defaultDepositPct * 100)) : "");

  if (!data.isGrowth) {
    return (
      <Page>
        <TitleBar title="Payments" />
        <Banner tone="info" title="Deposits & payment plans — upgrade to Growth">
          <p>
            Take a deposit up front, split large orders into installments, or send a
            secure pay-by-link. All capture runs through Shopify checkout — Mannon
            never stores card data. Flexible payments are included on Growth.
          </p>
          <Box paddingBlockStart="200">
            <Button url="/app/settings?upgrade=Growth" variant="primary">See Growth</Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Payments" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        <Text as="p" tone="subdued" variant="bodyMd">
          Take a deposit, split an order into installments, or send a secure
          pay-by-link. Every payment is captured by Shopify checkout — Mannon never
          sees card details.
        </Text>

        {/* Default deposit policy */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="default-deposit" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Default deposit policy</Text>
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="200px">
                  <TextField label="Default deposit %" name="depositPct" type="number" value={deposit} onChange={setDeposit} min={0} max={100} suffix="%" autoComplete="off" helpText="Pre-fills the deposit when you set up a plan. Leave blank for none." />
                </Box>
                <Button submit loading={busy}>Save policy</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* Orders needing a plan */}
        <Card padding="0">
          <Box padding="400"><Text as="h2" variant="headingMd">Orders ready for a payment plan</Text></Box>
          {data.eligible.length === 0 ? (
            <EmptyState heading="No orders waiting" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Accepted orders without a payment plan show up here.</p>
            </EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: "order", plural: "orders" }} itemCount={data.eligible.length} selectable={false} headings={[{ title: "Company" }, { title: "Total" }, { title: "" }]}>
              {data.eligible.map((o, i) => (
                <IndexTable.Row id={o.quoteId} key={o.quoteId} position={i}>
                  <IndexTable.Cell>{o.companyName}</IndexTable.Cell>
                  <IndexTable.Cell>{o.currency} {o.total}</IndexTable.Cell>
                  <IndexTable.Cell><Button url={`/app/payments/${o.quoteId}`} size="micro">Set up plan</Button></IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* Existing plans + overdue filter */}
        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Payment plans</Text>
              <InlineStack gap="200">
                <Button url="/app/payments" pressed={!data.overdueOnly} size="slim">All</Button>
                <Button url="/app/payments?filter=overdue" pressed={data.overdueOnly} size="slim" tone="critical">Overdue</Button>
              </InlineStack>
            </InlineStack>
          </Box>
          {data.plans.length === 0 ? (
            <EmptyState heading={data.overdueOnly ? "Nothing overdue" : "No plans yet"} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>{data.overdueOnly ? "No installments are overdue." : "Set up a plan on an order above."}</p>
            </EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: "plan", plural: "plans" }} itemCount={data.plans.length} selectable={false} headings={[{ title: "Company" }, { title: "Type" }, { title: "Status" }, { title: "Remaining" }, { title: "" }]}>
              {data.plans.map((p, i) => (
                <IndexTable.Row id={p.quoteId} key={p.quoteId} position={i}>
                  <IndexTable.Cell>{p.companyName}</IndexTable.Cell>
                  <IndexTable.Cell>{p.type}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={STATUS_TONE[p.status] ?? "attention"}>{p.status}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>{p.currency} {p.remaining}</IndexTable.Cell>
                  <IndexTable.Cell><Button url={`/app/payments/${p.quoteId}`} size="micro">Manage</Button></IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
