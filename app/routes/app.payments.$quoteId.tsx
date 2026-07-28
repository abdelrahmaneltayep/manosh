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
  Select,
  IndexTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { flexPayAllowed } from "../lib/billing";
import { computeDeposit } from "../lib/payments";
import {
  getPlanForQuote,
  createPaymentPlan,
  issuePayLink,
  markInstallmentPaid,
  getDefaultDepositPct,
  listEligibleOrders,
  PlanExistsError,
  NotFoundError,
} from "../services/payments.server";

// The serialized shape after useLoaderData (Date -> string).
type SerializedPlan = {
  id: string;
  type: string;
  status: string;
  total: string;
  currency: string;
  paid: string;
  remaining: string;
  installments: Array<{ id: string; label: string | null; amount: string; dueDate: string; status: string; paidAt: string | null }>;
};

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_FLEX_PAY === "true";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!flexPayAllowed(status.plan)) throw new Response("Not found", { status: 404 });
  const quoteId = params.quoteId!;

  const plan = await getPlanForQuote(quoteId);
  // For a not-yet-planned order, surface its total from the eligible list.
  const eligible = plan ? null : (await listEligibleOrders(session.shop)).find((o) => o.quoteId === quoteId) ?? null;
  const defaultDepositPct = await getDefaultDepositPct(session.shop);
  return { quoteId, plan, eligible, defaultDepositPct };
};

type ActionResult =
  | { ok: true; message: string; payUrl?: string }
  | { ok: false; error: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!flexPayAllowed(status.plan)) return { ok: false, error: "Flexible payments are a Growth feature." };
  const quoteId = params.quoteId!;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  try {
    if (intent === "create") {
      const type = String(form.get("type") ?? "DEPOSIT") as "DEPOSIT" | "INSTALLMENTS" | "PAYLINK";
      const depositRaw = String(form.get("depositPct") ?? "").trim();
      await createPaymentPlan(quoteId, {
        type,
        depositPct: depositRaw === "" ? undefined : Number(depositRaw) / 100,
        installments: Number(form.get("installments")) || undefined,
        intervalDays: Number(form.get("intervalDays")) || undefined,
        dueInDays: Number(form.get("dueInDays")) || undefined,
      });
      return { ok: true, message: "Payment plan created." };
    }
    if (intent === "paylink") {
      const installmentId = String(form.get("installmentId") ?? "").trim() || null;
      const { url } = await issuePayLink(quoteId, { installmentId, baseUrl });
      return { ok: true, message: "Pay-by-link created — copy it below.", payUrl: url };
    }
    if (intent === "mark-paid") {
      await markInstallmentPaid(String(form.get("installmentId") ?? ""));
      return { ok: true, message: "Installment marked paid." };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof PlanExistsError) return { ok: false, error: "This order already has a payment plan." };
    if (error instanceof NotFoundError) return { ok: false, error: "Order not found." };
    throw error;
  }
};

const STATUS_TONE: Record<string, "success" | "attention" | "critical"> = { PAID: "success", PENDING: "attention", OVERDUE: "critical" };

export default function PaymentPlanPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [type, setType] = useState("DEPOSIT");
  const [depositPct, setDepositPct] = useState(data.defaultDepositPct != null ? String(Math.round(data.defaultDepositPct * 100)) : "30");
  const [installments, setInstallments] = useState("3");
  const [intervalDays, setIntervalDays] = useState("30");
  const [dueInDays, setDueInDays] = useState("30");

  const total = data.plan?.total ?? data.eligible?.total ?? "0.00";
  const currency = data.plan?.currency ?? data.eligible?.currency ?? "USD";
  const preview = type !== "PAYLINK" && depositPct ? computeDeposit(total, Number(depositPct) / 100) : null;

  return (
    <Page backAction={{ url: "/app/payments" }} title="Payment plan">
      <TitleBar title="Payment plan" />
      <BlockStack gap="500">
        {actionData?.ok === true && (
          <Banner tone="success" title={actionData.message}>
            {actionData.payUrl && <p><code>{actionData.payUrl}</code></p>}
          </Banner>
        )}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        {!data.plan ? (
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="create" />
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Set up a plan · {currency} {total}</Text>
                <InlineStack gap="300" blockAlign="end" wrap>
                  <Select
                    label="Plan type"
                    name="type"
                    options={[
                      { label: "Deposit + balance", value: "DEPOSIT" },
                      { label: "Installments", value: "INSTALLMENTS" },
                      { label: "Pay-by-link (full)", value: "PAYLINK" },
                    ]}
                    value={type}
                    onChange={setType}
                  />
                  {type !== "PAYLINK" && (
                    <Box minWidth="140px"><TextField label="Deposit %" name="depositPct" type="number" value={depositPct} onChange={setDepositPct} min={0} max={99} suffix="%" autoComplete="off" /></Box>
                  )}
                  {type === "INSTALLMENTS" && (
                    <>
                      <Box minWidth="120px"><TextField label="Installments" name="installments" type="number" value={installments} onChange={setInstallments} min={1} autoComplete="off" /></Box>
                      <Box minWidth="120px"><TextField label="Every N days" name="intervalDays" type="number" value={intervalDays} onChange={setIntervalDays} min={1} autoComplete="off" /></Box>
                    </>
                  )}
                  <Box minWidth="140px"><TextField label="First due in (days)" name="dueInDays" type="number" value={dueInDays} onChange={setDueInDays} min={0} autoComplete="off" /></Box>
                  <Button variant="primary" submit loading={busy}>Create plan</Button>
                </InlineStack>
                {preview && (
                  <Text as="p" tone="subdued" variant="bodySm">
                    Deposit now: <b>{currency} {preview.deposit}</b> · Balance: <b>{currency} {preview.balance}</b>. The deposit is collected through Shopify checkout.
                  </Text>
                )}
              </BlockStack>
            </Form>
          </Card>
        ) : (
          <PlanDetail plan={data.plan} busy={busy} />
        )}
      </BlockStack>
    </Page>
  );
}

function PlanDetail({ plan, busy }: { plan: SerializedPlan; busy: boolean }) {
  return (
    <>
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">{plan.type} · {plan.currency} {plan.total}</Text>
            <Badge tone={plan.status === "COMPLETED" ? "success" : plan.status === "OVERDUE" ? "critical" : "attention"}>{plan.status}</Badge>
          </InlineStack>
          <Text as="p" tone="subdued" variant="bodySm">Paid {plan.currency} {plan.paid} · Remaining {plan.currency} {plan.remaining}</Text>
          <Form method="post">
            <input type="hidden" name="intent" value="paylink" />
            <InlineStack gap="200">
              <Button submit loading={busy}>Create pay-by-link for the balance</Button>
            </InlineStack>
          </Form>
        </BlockStack>
      </Card>

      <Card padding="0">
        <Box padding="400"><Text as="h2" variant="headingMd">Schedule</Text></Box>
        <IndexTable resourceName={{ singular: "installment", plural: "installments" }} itemCount={plan.installments.length} selectable={false} headings={[{ title: "Installment" }, { title: "Amount" }, { title: "Due" }, { title: "Status" }, { title: "" }]}>
          {plan.installments.map((it, i) => (
            <IndexTable.Row id={it.id} key={it.id} position={i}>
              <IndexTable.Cell>{it.label ?? `#${i + 1}`}</IndexTable.Cell>
              <IndexTable.Cell>{plan.currency} {it.amount}</IndexTable.Cell>
              <IndexTable.Cell>{new Date(it.dueDate).toISOString().slice(0, 10)}</IndexTable.Cell>
              <IndexTable.Cell><Badge tone={STATUS_TONE[it.status] ?? "attention"}>{it.status}</Badge></IndexTable.Cell>
              <IndexTable.Cell>
                {it.status !== "PAID" && (
                  <InlineStack gap="200">
                    <Form method="post">
                      <input type="hidden" name="intent" value="paylink" />
                      <input type="hidden" name="installmentId" value={it.id} />
                      <Button submit size="micro" loading={busy}>Pay-link</Button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="mark-paid" />
                      <input type="hidden" name="installmentId" value={it.id} />
                      <Button submit size="micro" variant="tertiary" loading={busy}>Mark paid</Button>
                    </Form>
                  </InlineStack>
                )}
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </>
  );
}
