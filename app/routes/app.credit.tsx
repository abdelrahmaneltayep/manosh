import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Badge,
  Banner,
  Button,
  Box,
  Divider,
  Select,
  TextField,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { featureAccess, GROWTH_PLAN } from "../lib/billing";
import { appendEvent } from "../services/events.server";
import prisma from "../db.server";
import {
  getAgingReport,
  listRecentInvoicesForShop,
  invoiceBelongsToShop,
  markInvoicePaid,
} from "../services/invoice.server";
import {
  listCompaniesWithCredit,
  companyBelongsToShop,
  upsertCreditProfile,
  validateCreditProfile,
  TERM_OPTIONS,
} from "../services/credit.server";
import { AGING_BUCKETS, AGING_LABELS } from "../lib/aging";
import { formatDate } from "../lib/format";

const IS_TEST = process.env.NODE_ENV !== "production";
const CREDIT_ENABLED = () => process.env.MANNON_FF_CREDIT === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const enabled = CREDIT_ENABLED();
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const growth = featureAccess(status, GROWTH_PLAN).allowed;

  const invoices = enabled ? await listRecentInvoicesForShop(session.shop) : [];
  // Credit limits, aging, and profiles are Growth-only.
  const aging = enabled && growth ? await getAgingReport(session.shop) : null;
  const companies = enabled && growth ? await listCompaniesWithCredit(session.shop) : [];

  return {
    enabled,
    growth,
    aging,
    companies,
    termOptions: [...TERM_OPTIONS] as number[],
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.id.slice(-8).toUpperCase(),
      companyName: i.companyName,
      amount: i.amount,
      currency: i.currency,
      status: i.status,
      dueDate: i.dueDate,
    })),
  };
};

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!CREDIT_ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Credit-profile writes are Growth-only.
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const growth = featureAccess(status, GROWTH_PLAN).allowed;

  if (intent === "mark-paid") {
    const invoiceId = String(form.get("invoiceId") ?? "");
    if (!(await invoiceBelongsToShop(invoiceId, session.shop))) {
      return { ok: false, error: "That invoice isn’t on this store." };
    }
    await markInvoicePaid(invoiceId);
    return { ok: true, message: "Invoice marked paid." };
  }

  if (intent === "save-profile") {
    if (!growth) return { ok: false, error: "Credit limits are a Growth feature." };
    const companyId = String(form.get("companyId") ?? "");
    if (!(await companyBelongsToShop(companyId, session.shop))) {
      return { ok: false, error: "Choose one of your companies." };
    }
    const parsed = validateCreditProfile({
      creditLimit: Number(form.get("creditLimit")),
      termsDays: Number(form.get("termsDays")),
      status: String(form.get("status") ?? "ACTIVE"),
    });
    if (!parsed.ok) return { ok: false, error: parsed.error };
    await upsertCreditProfile(companyId, parsed.value);

    // An override (a reason supplied while raising a limit or clearing a hold) is
    // logged for the audit trail. Numbers only in the payload (guardrail #6).
    const reason = String(form.get("reason") ?? "").trim();
    if (reason) {
      const shop = await prisma.shop.findUnique({
        where: { shopifyDomain: session.shop },
        select: { id: true },
      });
      if (shop) {
        await appendEvent({
          shopId: shop.id,
          type: "CREDIT_OVERRIDE",
          entityType: "Company",
          entityId: companyId,
          payload: { creditLimit: parsed.value.creditLimit, reasonLength: reason.length },
        });
      }
    }
    return { ok: true, message: "Credit profile saved." };
  }

  return { ok: false, error: "Unknown action." };
};

export default function Credit() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [companyId, setCompanyId] = useState(data.companies[0]?.id ?? "");
  const selected = data.companies.find((c) => c.id === companyId);
  const [limit, setLimit] = useState(String(selected?.creditLimit ?? 0));
  const [terms, setTerms] = useState(String(selected?.termsDays ?? 30));
  const [holdStatus, setHoldStatus] = useState(selected?.status ?? "ACTIVE");
  const [reason, setReason] = useState("");

  const onPickCompany = (id: string) => {
    setCompanyId(id);
    const c = data.companies.find((x) => x.id === id);
    setLimit(String(c?.creditLimit ?? 0));
    setTerms(String(c?.termsDays ?? 30));
    setHoldStatus(c?.status ?? "ACTIVE");
    setReason("");
  };

  return (
    <Page>
      <TitleBar title="Credit & invoices" />
      <BlockStack gap="500">
        {actionData && !actionData.ok && (
          <Banner tone="critical" title="Couldn’t save">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {actionData && actionData.ok && <Banner tone="success" title={actionData.message} />}

        {!data.growth && (
          <Banner tone="warning" title="Credit control is a Growth feature">
            <p>
              Starter includes net terms and due dates on invoices. Upgrade to
              Growth for credit limits, the aging dashboard, automatic reminders,
              and invoice PDFs.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/settings" variant="primary">
                Upgrade to Growth
              </Button>
            </Box>
          </Banner>
        )}

        {/* Aging dashboard (Growth) */}
        {data.growth && data.aging && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Aging
              </Text>
              <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
                {AGING_BUCKETS.map((b) => (
                  <Box key={b} background="bg-surface-secondary" borderRadius="200" padding="300">
                    <Text as="p" tone="subdued" variant="bodySm">
                      {AGING_LABELS[b]}
                    </Text>
                    <Text as="p" variant="headingLg">
                      {data.aging!.totals[b].toFixed(2)}
                    </Text>
                  </Box>
                ))}
              </InlineGrid>
              {data.aging.rows.length === 0 ? (
                <Text as="p" tone="subdued">
                  No outstanding balances yet. Invoices appear here once net-terms
                  orders are placed.
                </Text>
              ) : (
                <BlockStack gap="0">
                  {data.aging.rows.map((r, i) => (
                    <div key={r.companyId}>
                      {i > 0 && <Divider />}
                      <Box paddingBlock="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" fontWeight="semibold">
                              {r.companyName}
                            </Text>
                            {r.onHold && <Badge tone="critical">On hold</Badge>}
                          </InlineStack>
                          <Text as="span" numeric>
                            {r.outstanding.toFixed(2)}
                            {r.creditLimit > 0 ? ` / ${r.creditLimit.toFixed(2)} limit` : ""}
                          </Text>
                        </InlineStack>
                      </Box>
                    </div>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}

        {/* Credit profile editor (Growth) */}
        {data.growth && data.companies.length > 0 && (
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="save-profile" />
              <input type="hidden" name="companyId" value={companyId} />
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Set a credit profile
                </Text>
                <Select
                  label="Company"
                  options={data.companies.map((c) => ({ label: c.name, value: c.id }))}
                  value={companyId}
                  onChange={onPickCompany}
                />
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                  <TextField
                    label="Credit limit"
                    type="number"
                    name="creditLimit"
                    value={limit}
                    onChange={setLimit}
                    min={0}
                    step={0.01}
                    prefix="$"
                    autoComplete="off"
                    helpText="0 = no limit"
                  />
                  <Select
                    label="Terms (days)"
                    name="termsDays"
                    options={data.termOptions.map((t) => ({ label: `Net ${t}`, value: String(t) }))}
                    value={terms}
                    onChange={setTerms}
                  />
                  <Select
                    label="Status"
                    name="status"
                    options={[
                      { label: "Active", value: "ACTIVE" },
                      { label: "On hold", value: "HOLD" },
                    ]}
                    value={holdStatus}
                    onChange={(v) => setHoldStatus(v as "ACTIVE" | "HOLD")}
                  />
                </InlineGrid>
                <TextField
                  label="Override reason (optional)"
                  name="reason"
                  value={reason}
                  onChange={setReason}
                  autoComplete="off"
                  helpText="If you're raising a limit or clearing a hold to let an order through, note why — it's logged."
                />
                <InlineStack>
                  <Button variant="primary" submit loading={submitting}>
                    Save profile
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        )}

        {/* Invoices (all plans — due dates; Growth adds paid/aging context) */}
        <Card padding="0">
          <Box padding="400">
            <Text as="h2" variant="headingMd">
              Invoices
            </Text>
          </Box>
          {data.invoices.length === 0 ? (
            <EmptyState
              heading="No invoices yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Net-terms orders raise an invoice here with its due date.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "invoice", plural: "invoices" }}
              itemCount={data.invoices.length}
              selectable={false}
              headings={[
                { title: "Invoice" },
                { title: "Company" },
                { title: "Amount" },
                { title: "Due" },
                { title: "Status" },
                { title: "" },
              ]}
            >
              {data.invoices.map((inv, index) => (
                <IndexTable.Row id={inv.id} key={inv.id} position={index}>
                  <IndexTable.Cell>#{inv.number}</IndexTable.Cell>
                  <IndexTable.Cell>{inv.companyName}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {inv.currency} {Number(inv.amount).toFixed(2)}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{formatDate(inv.dueDate)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InvoiceStatusBadge status={inv.status} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {inv.status !== "PAID" && inv.status !== "VOID" && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="mark-paid" />
                        <input type="hidden" name="invoiceId" value={inv.id} />
                        <Button size="slim" submit>
                          Mark paid
                        </Button>
                      </Form>
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const tone =
    status === "PAID" ? "success" : status === "OVERDUE" ? "critical" : status === "VOID" ? undefined : "attention";
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return <Badge tone={tone as never}>{label}</Badge>;
}
