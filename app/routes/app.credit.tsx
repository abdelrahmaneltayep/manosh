import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
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
import { SectionTabs } from "../components/SectionTabs";
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
import { formatDate, formatMoney } from "../lib/format";
import { claudeAccess, CLAUDE_UNAVAILABLE_COPY, CLAUDE_UPGRADE_COPY, CLAUDE_TRIAL_ENDED_COPY, type ClaudeAccess } from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draftCreditRiskFlag } from "../services/insights-ai.server";
import { DraftedByClaude } from "../components/DraftedByClaude";
import { DisclosureCard } from "../components/DisclosureCard";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { upgradeUrl } from "../lib/upgrade";

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

  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());

  return {
    enabled,
    growth,
    access,
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
  | { ok: false; error: string }
  | { ok: true; kind: "risk"; level: "low" | "watch" | "high"; rationale: string; recommendation: string; companyName: string }
  | { ok: false; kind: "risk"; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!CREDIT_ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // AI-15 credit-risk flag — Claude reads the company's payment behaviour and
  // returns an advisory level + recommendation. Dual-mode: read-only, changes
  // nothing (guardrail #4).
  if (intent === "ai-credit-risk") {
    const { access } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return {
        ok: false,
        kind: "risk",
        error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY,
      };
    }
    try {
      const r = await draftCreditRiskFlag(session.shop, String(form.get("companyId") ?? ""));
      if (!r) return { ok: false, kind: "risk", error: "Not enough history for that company yet." };
      return { ok: true, kind: "risk", level: r.level, rationale: r.rationale, recommendation: r.recommendation, companyName: r.companyName };
    } catch {
      return { ok: false, kind: "risk", error: CLAUDE_UNAVAILABLE_COPY };
    }
  }

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

function CreditRiskAssessor({
  companies,
  companyId,
  onPickCompany,
  access,
}: {
  companies: { id: string; name: string }[];
  companyId: string;
  onPickCompany: (id: string) => void;
  access: Pick<ClaudeAccess, "allowed" | "reason">;
}) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const d = fetcher.data;
  const risk = d && d.ok && "kind" in d && d.kind === "risk" ? d : null;
  const err = d && !d.ok && "kind" in d && d.kind === "risk" ? d.error : null;
  const tone = risk ? (risk.level === "high" ? "critical" : risk.level === "watch" ? "warning" : "success") : undefined;
  const label = risk ? (risk.level === "high" ? "High risk" : risk.level === "watch" ? "Watch" : "Low risk") : "";
  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Credit-risk read</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            A plain-language read of a company's payment history. It's advice only — nothing changes until you save a profile.
          </Text>
        </BlockStack>
        {access.allowed ? (
          <>
            <InlineStack gap="200" blockAlign="end" wrap>
              <Box minWidth="16rem">
                <Select
                  label="Company"
                  options={companies.map((c) => ({ label: c.name, value: c.id }))}
                  value={companyId}
                  onChange={onPickCompany}
                />
              </Box>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="ai-credit-risk" />
                <input type="hidden" name="companyId" value={companyId} />
                <Button submit disabled={busy || !companyId} loading={busy}>
                  ✦ Assess risk with Claude
                </Button>
              </fetcher.Form>
            </InlineStack>
            {err && <Banner tone="warning">{err}</Banner>}
            {risk && (
              <DraftedByClaude>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={tone}>{label}</Badge>
                    <Text as="span" variant="bodySm" tone="subdued">{risk.companyName}</Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd">{risk.rationale}</Text>
                  {risk.recommendation && (
                    <Text as="p" variant="bodyMd" fontWeight="semibold">Suggested: {risk.recommendation}</Text>
                  )}
                </BlockStack>
              </DraftedByClaude>
            )}
          </>
        ) : (
          <UpgradeToClaude access={access as ClaudeAccess} upgradeUrl={upgradeUrl("growth")} />
        )}
      </BlockStack>
    </Card>
  );
}

export default function Credit() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const busyIntent = submitting ? String(navigation.formData?.get("intent") ?? "") : "";

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

  // First run (nothing owed, nothing invoiced): open setup so the next step is obvious.
  const firstRun = data.invoices.length === 0 && (data.aging?.rows.length ?? 0) === 0;

  return (
    <Page>
      <TitleBar title="Credit" />
      <SectionTabs active="credit" />
      <BlockStack gap="500">
        {actionData && !actionData.ok && !("kind" in actionData) && (
          <Banner tone="critical" title="Couldn’t save">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {actionData && actionData.ok && !("kind" in actionData) && (
          <Banner tone="success" title={actionData.message} />
        )}

        {/* 1. Aging summary (Growth) — what's owed, at a glance */}
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
                  No outstanding balances yet. Balances appear here once net-terms
                  orders are invoiced.
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

        {/* 2. Invoices — the daily task (all plans) */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Invoices
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Mark an invoice paid when the money arrives so balances and holds stay accurate.
              </Text>
            </BlockStack>
          </Box>
          {data.invoices.length === 0 ? (
            <EmptyState
              heading="No invoices yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>When a buyer places an order on net terms, its invoice and due date show up here.</p>
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
                { title: "Actions", hidden: true },
              ]}
            >
              {data.invoices.map((inv, index) => (
                <IndexTable.Row id={inv.id} key={inv.id} position={index}>
                  <IndexTable.Cell>#{inv.number}</IndexTable.Cell>
                  <IndexTable.Cell>{inv.companyName}</IndexTable.Cell>
                  <IndexTable.Cell>{formatMoney(String(inv.amount), inv.currency)}</IndexTable.Cell>
                  <IndexTable.Cell>{formatDate(inv.dueDate)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InvoiceStatusBadge status={inv.status} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {inv.status !== "PAID" && inv.status !== "VOID" && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="mark-paid" />
                        <input type="hidden" name="invoiceId" value={inv.id} />
                        <Button
                          size="slim"
                          submit
                          accessibilityLabel={`Mark invoice ${inv.number} paid`}
                          loading={busyIntent === "mark-paid" && navigation.formData?.get("invoiceId") === inv.id}
                        >
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

        {!data.growth && (
          <Banner tone="warning" title="Credit control is a Growth feature">
            <p>
              Starter includes net terms and due dates on invoices. Upgrade to
              Growth for credit limits, the aging dashboard, automatic reminders,
              and invoice PDFs.
            </p>
            <Box paddingBlockStart="200">
              <Button url={upgradeUrl("growth")} variant="primary">
                Upgrade to Growth
              </Button>
            </Box>
          </Banner>
        )}

        {/* 3. Credit profile editor (Growth) — setup, one click away */}
        {data.growth && (
          <DisclosureCard
            title="Set a credit profile"
            subtitle="Give a company a credit limit, payment terms, or put it on hold."
            defaultOpen={firstRun}
          >
            {data.companies.length === 0 ? (
              <Text as="p" tone="subdued">
                You don't have any B2B companies yet. Companies appear here once they exist on your store.
              </Text>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="save-profile" />
                <input type="hidden" name="companyId" value={companyId} />
                <BlockStack gap="300">
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
                      helpText="Enter 0 for no limit."
                    />
                    <Select
                      label="Payment terms"
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
                    <Button variant="primary" submit loading={busyIntent === "save-profile"}>
                      Save profile
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            )}
          </DisclosureCard>
        )}

        {/* 4. AI-15 credit-risk read (Growth + Claude) — advisory */}
        {data.growth && data.companies.length > 0 && (
          <CreditRiskAssessor
            companies={data.companies}
            companyId={companyId}
            onPickCompany={onPickCompany}
            access={data.access}
          />
        )}
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
