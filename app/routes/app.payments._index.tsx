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
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { flexPayAllowed, GROWTH_PLAN } from "../lib/billing";
import { listPlansForShop, listEligibleOrders, getDefaultDepositPct, setDefaultDepositPct } from "../services/payments.server";
import { upgradeUrl } from "../lib/upgrade";
import { formatMoney } from "../lib/format";
import { DisclosureCard } from "../components/DisclosureCard";

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
const STATUS_LABELS: Record<string, string> = { COMPLETED: "Completed", ACTIVE: "Active", OVERDUE: "Overdue" };
const TYPE_LABELS: Record<string, string> = {
  DEPOSIT: "Deposit + balance",
  INSTALLMENTS: "Installments",
  PAYLINK: "Pay-by-link",
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
        <SectionTabs active="payments" />
        <Banner tone="info" title="Deposits & payment plans — upgrade to Growth">
          <p>
            Take a deposit up front, split large orders into installments, or send a
            secure pay-by-link. All capture runs through Shopify checkout — Mannon
            never stores card data. Flexible payments are included on Growth.
          </p>
          <Box paddingBlockStart="200">
            <Button url={upgradeUrl("growth")} variant="primary">See Growth</Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  const firstRun = data.eligible.length === 0 && data.plans.length === 0 && !data.overdueOnly;

  return (
    <Page>
      <TitleBar title="Payments" />
      <SectionTabs active="payments" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        {/* 1. Orders needing a plan */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Orders ready for a payment plan</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Take a deposit, split an order into installments, or send a secure pay-by-link. Shopify
                checkout captures every payment — Mannon never sees card details.
              </Text>
            </BlockStack>
          </Box>
          {data.eligible.length === 0 ? (
            <EmptyState
              heading="No orders waiting"
              action={{ content: "View quotes", url: "/app/quotes" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>When a buyer accepts a quote, the order shows up here so you can set up a payment plan.</p>
            </EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: "order", plural: "orders" }} itemCount={data.eligible.length} selectable={false} headings={[{ title: "Company" }, { title: "Total" }, { title: "Actions", hidden: true }]}>
              {data.eligible.map((o, i) => (
                <IndexTable.Row id={o.quoteId} key={o.quoteId} position={i}>
                  <IndexTable.Cell>{o.companyName}</IndexTable.Cell>
                  <IndexTable.Cell>{formatMoney(o.total, o.currency)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button url={`/app/payments/${o.quoteId}`} size="micro" accessibilityLabel={`Set up a payment plan for ${o.companyName}`}>Set up plan</Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* 2. Existing plans + overdue filter */}
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
            <EmptyState
              heading={data.overdueOnly ? "Nothing overdue" : "No payment plans yet"}
              action={data.overdueOnly ? { content: "Show all plans", url: "/app/payments" } : undefined}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                {data.overdueOnly
                  ? "Every installment is paid or not yet due."
                  : "Plans you set up on an order above are tracked here until they're paid in full."}
              </p>
            </EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: "plan", plural: "plans" }} itemCount={data.plans.length} selectable={false} headings={[{ title: "Company" }, { title: "Type" }, { title: "Status" }, { title: "Remaining" }, { title: "Actions", hidden: true }]}>
              {data.plans.map((p, i) => (
                <IndexTable.Row id={p.quoteId} key={p.quoteId} position={i}>
                  <IndexTable.Cell>{p.companyName}</IndexTable.Cell>
                  <IndexTable.Cell>{TYPE_LABELS[p.type] ?? p.type}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={STATUS_TONE[p.status] ?? "attention"}>{STATUS_LABELS[p.status] ?? p.status}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>{formatMoney(p.remaining, p.currency)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Button url={`/app/payments/${p.quoteId}`} size="micro" accessibilityLabel={`Manage the payment plan for ${p.companyName}`}>Manage</Button>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* 3. Setup: default deposit policy */}
        <DisclosureCard
          title="Default deposit policy"
          subtitle={
            data.defaultDepositPct != null
              ? `New plans start with a ${Math.round(data.defaultDepositPct * 100)}% deposit.`
              : "Pre-fill a deposit percentage when you set up a plan."
          }
          defaultOpen={firstRun}
        >
          <Form method="post">
            <input type="hidden" name="intent" value="default-deposit" />
            <InlineStack gap="300" blockAlign="end" wrap>
              <Box minWidth="200px">
                <TextField label="Default deposit %" name="depositPct" type="number" value={deposit} onChange={setDeposit} min={0} max={100} suffix="%" autoComplete="off" helpText="Pre-fills the deposit when you set up a plan. Leave blank for none." />
              </Box>
              <Button submit loading={busy}>Save policy</Button>
            </InlineStack>
          </Form>
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
