import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
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
  Divider,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { getPlanLimits, GROWTH_PLAN } from "../lib/billing";
import { evaluateFormAllowance, formCapMessage, STATUS_LABELS } from "../lib/wholesale";
import {
  listForms,
  createForm,
  listApplications,
  decideApplication,
  WholesaleFormCapError,
} from "../services/wholesale.server";
import { formatDate } from "../lib/format";
import prisma from "../db.server";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draftDecisionNote, isWholesaleDecision } from "../services/wholesale-ai.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_WHOLESALE_REG === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const cap = getPlanLimits(status.plan).wholesaleFormCap;

  const [forms, applications] = await Promise.all([
    listForms(session.shop),
    listApplications(session.shop),
  ]);
  const allowance = evaluateFormAllowance(forms.length, cap);
  const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());

  return {
    isGrowth: status.plan === GROWTH_PLAN,
    access,
    forms,
    applications: applications.map((a) => ({
      id: a.id,
      companyName: a.companyName,
      contactEmail: a.contactEmail,
      status: a.status,
      createdAt: a.createdAt,
    })),
    allowance: { allowed: allowance.allowed, used: allowance.used, cap: Number.isFinite(cap) ? cap : null },
    capMessage: formCapMessage(Number.isFinite(cap) ? cap : 1),
    publicUrl: `${appUrl}/apply/${session.shop}`,
  };
};

type ActionResult =
  | { ok: true; message?: string; draft?: { applicationId: string; decision: string; note: string } }
  | { ok: false; error: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs): Promise<Response | ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const cap = getPlanLimits(status.plan).wholesaleFormCap;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  // --- F6 dual-mode: Claude drafts a decision note; merchant edits + sends -----
  if (intent === "ai-wholesale-note") {
    const { access } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, upgrade: true, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    const id = String(form.get("applicationId") ?? "");
    const decision = String(form.get("decision") ?? "");
    if (!isWholesaleDecision(decision)) return { ok: false, error: "Pick a decision first." };
    const drafted = await draftDecisionNote(session.shop, id, decision);
    if (!drafted) return { ok: false, error: "That application is no longer available." };
    return { ok: true, draft: drafted };
  }

  try {
    if (intent === "create-form") {
      const created = await createForm(session.shop, String(form.get("name") ?? ""), cap);
      return redirect(`/app/wholesale/forms/${created.id}`);
    }
    if (intent === "decide") {
      const id = String(form.get("applicationId") ?? "");
      const decision = String(form.get("decision") ?? "") as "APPROVED" | "REJECTED" | "MORE_INFO";
      const customNote = String(form.get("note") ?? "").trim() || undefined;
      await decideApplication(session.shop, id, decision, session.shop, baseUrl, { customNote });
      const verb = decision === "APPROVED" ? "approved" : decision === "REJECTED" ? "rejected" : "marked for more info";
      return { ok: true, message: `Application ${verb}.` };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof WholesaleFormCapError) return { ok: false, error: formCapMessage(error.cap) };
    throw error;
  }
};

function statusTone(s: string) {
  return s === "APPROVED" ? "success" : s === "REJECTED" ? "critical" : s === "MORE_INFO" ? "attention" : "info";
}

const DECISION_OPTIONS = [
  { label: "Approve", value: "APPROVED" },
  { label: "Request more info", value: "MORE_INFO" },
  { label: "Decline", value: "REJECTED" },
];

function WholesaleReplyRow({
  app,
  access,
  divider,
}: {
  app: { id: string; companyName: string; contactEmail: string };
  access: ClaudeAccess;
  divider: boolean;
}) {
  const draftFetcher = useFetcher<typeof action>();
  const drafting = draftFetcher.state !== "idle";
  const [decision, setDecision] = useState("APPROVED");
  const [note, setNote] = useState("");
  const d = draftFetcher.data;
  const draft = d && d.ok && d.draft && d.draft.applicationId === app.id ? d.draft : null;
  const draftErr = d && !d.ok ? d.error : null;

  return (
    <div>
      {divider && <Divider />}
      <Box paddingBlock="300">
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center" align="space-between" wrap>
            <InlineStack gap="200" blockAlign="center">
              <Link to={`/app/quotes`}>{app.companyName}</Link>
              <Text as="span" tone="subdued" variant="bodySm">{app.contactEmail}</Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="end">
              <Select label="Decision" labelHidden options={DECISION_OPTIONS} value={decision} onChange={setDecision} />
              {access.allowed && (
                <Button
                  size="slim"
                  disabled={drafting}
                  loading={drafting}
                  onClick={() => draftFetcher.submit({ intent: "ai-wholesale-note", applicationId: app.id, decision }, { method: "post" })}
                >
                  ✦ Draft with Claude
                </Button>
              )}
            </InlineStack>
          </InlineStack>

          {draftErr && <Banner tone="warning">{draftErr}</Banner>}
          {draft && (
            <Box background="bg-surface-secondary" borderRadius="200" padding="300">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">{draft.note}</Text>
                <InlineStack gap="200">
                  <Button size="slim" variant="primary" onClick={() => setNote(draft.note)}>Use this</Button>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Badge tone="info">✦ Drafted by Claude</Badge>
                  <Text as="span" variant="bodySm">{DRAFTED_BY_CLAUDE_TRUST}</Text>
                </InlineStack>
              </BlockStack>
            </Box>
          )}

          <Form method="post">
            <input type="hidden" name="intent" value="decide" />
            <input type="hidden" name="applicationId" value={app.id} />
            <input type="hidden" name="decision" value={decision} />
            <BlockStack gap="200">
              <TextField
                label="Note to applicant (optional)"
                labelHidden
                name="note"
                value={note}
                onChange={setNote}
                multiline={2}
                autoComplete="off"
                placeholder="Leave blank to send the default decision email, or draft a note with Claude above."
              />
              <InlineStack>
                <Button size="slim" submit>Send decision</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </BlockStack>
      </Box>
    </div>
  );
}

export default function WholesaleQueue() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [name, setName] = useState("");

  const error = actionData && !actionData.ok ? actionData.error : null;
  const message = actionData && actionData.ok ? actionData.message : null;
  const pending = data.applications.filter((a) => a.status === "PENDING");
  const respondable = data.applications.filter((a) => a.status === "PENDING" || a.status === "MORE_INFO");

  return (
    <Page>
      <TitleBar title="Wholesale" />
      <SectionTabs active="wholesale" />
      <BlockStack gap="500">
        {error && <Banner tone="critical" title="Couldn’t complete that"><p>{error}</p></Banner>}
        {message && <Banner tone="success" title={message} />}

        {/* Activation: publish your form */}
        {data.forms.length === 0 && (
          <Banner tone="info" title="Publish your wholesale form">
            <p>
              Create a branded “apply to buy wholesale” form, share its link, and
              approve buyers before they see your prices. It’s the top of your B2B
              funnel.
            </p>
            <Box paddingBlockStart="200">
              <Form method="post">
                <input type="hidden" name="intent" value="create-form" />
                <input type="hidden" name="name" value="Wholesale application" />
                <Button submit variant="primary" loading={submitting}>Create your first form</Button>
              </Form>
            </Box>
          </Banner>
        )}

        {/* Forms */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Application forms</Text>
              <Badge tone={data.allowance.allowed ? undefined : "attention"}>
                {data.allowance.cap === null ? `${data.allowance.used} · unlimited` : `${data.allowance.used} / ${data.allowance.cap}`}
              </Badge>
            </InlineStack>

            {data.forms.length > 0 && (
              <BlockStack gap="0">
                {data.forms.map((f, i) => (
                  <div key={f.id}>
                    {i > 0 && <Box borderBlockStartWidth="025" borderColor="border" />}
                    <Box paddingBlock="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <Link to={`/app/wholesale/forms/${f.id}`}>{f.name}</Link>
                          {f.isDefault && <Badge>Default</Badge>}
                          <Badge tone={f.published ? "success" : undefined}>{f.published ? "Published" : "Draft"}</Badge>
                        </InlineStack>
                        <Text as="span" tone="subdued" variant="bodySm">
                          {f.fieldCount} fields · {f.applicationCount} applications
                        </Text>
                      </InlineStack>
                    </Box>
                  </div>
                ))}
              </BlockStack>
            )}

            {data.allowance.allowed ? (
              <Form method="post">
                <input type="hidden" name="intent" value="create-form" />
                <InlineStack gap="200" blockAlign="end">
                  <Box minWidth="18rem">
                    <TextField label="New form name" name="name" value={name} onChange={setName} autoComplete="off" placeholder="e.g. Retailer application" />
                  </Box>
                  <Button submit loading={submitting}>Add form</Button>
                </InlineStack>
              </Form>
            ) : (
              <Banner tone="warning">
                <p>{data.capMessage}</p>
                <Box paddingBlockStart="200"><Button url="/app/settings" variant="primary">Upgrade to Growth</Button></Box>
              </Banner>
            )}

            {data.forms.some((f) => f.published) && (
              <Text as="p" tone="subdued" variant="bodySm">
                Public link: <code>{data.publicUrl}</code>
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* Respond with a personalised (Claude-drafted) note */}
        {respondable.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Respond with a note</Text>
                {data.access.state === "trial" && data.access.daysLeft != null && (
                  <Badge tone="attention">{`Claude trial · ${data.access.daysLeft} ${data.access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
                )}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Send your decision with a personal note. Draft it with Claude, review, then send.
              </Text>
              {!data.access.allowed && <UpgradeToClaude access={data.access as ClaudeAccess} upgradeUrl="/app/settings" />}
              <BlockStack gap="0">
                {respondable.map((a, i) => (
                  <WholesaleReplyRow key={a.id} app={a} access={data.access as ClaudeAccess} divider={i > 0} />
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* Approval queue */}
        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Approval queue</Text>
              {pending.length > 0 && <Badge tone="attention">{`${pending.length} pending`}</Badge>}
            </InlineStack>
          </Box>
          {data.applications.length === 0 ? (
            <EmptyState heading="No applications yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Share your form link and applications will land here for review.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "application", plural: "applications" }}
              itemCount={data.applications.length}
              selectable={false}
              headings={[{ title: "Company" }, { title: "Contact" }, { title: "Received" }, { title: "Status" }, { title: "Decision" }]}
            >
              {data.applications.map((a, index) => (
                <IndexTable.Row id={a.id} key={a.id} position={index}>
                  <IndexTable.Cell>{a.companyName}</IndexTable.Cell>
                  <IndexTable.Cell>{a.contactEmail}</IndexTable.Cell>
                  <IndexTable.Cell>{formatDate(a.createdAt)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={statusTone(a.status) as never}>{STATUS_LABELS[a.status]}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {a.status === "PENDING" || a.status === "MORE_INFO" ? (
                      <InlineStack gap="150">
                        <Form method="post">
                          <input type="hidden" name="intent" value="decide" />
                          <input type="hidden" name="applicationId" value={a.id} />
                          <input type="hidden" name="decision" value="APPROVED" />
                          <Button size="slim" submit>Approve</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="decide" />
                          <input type="hidden" name="applicationId" value={a.id} />
                          <input type="hidden" name="decision" value="MORE_INFO" />
                          <Button size="slim" variant="plain" submit>More info</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="decide" />
                          <input type="hidden" name="applicationId" value={a.id} />
                          <input type="hidden" name="decision" value="REJECTED" />
                          <Button size="slim" variant="plain" tone="critical" submit>Reject</Button>
                        </Form>
                      </InlineStack>
                    ) : (
                      <Text as="span" tone="subdued" variant="bodySm">—</Text>
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
