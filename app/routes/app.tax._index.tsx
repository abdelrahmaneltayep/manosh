import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
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
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { ConfirmAction } from "../components/ConfirmAction";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { taxCertWorkflowAllowed, GROWTH_PLAN } from "../lib/billing";
import { validateTaxId, type TaxIdType } from "../lib/tax";
import {
  listProfilesForShop,
  verifyTaxProfile,
  rejectTaxProfile,
  setManualExempt,
  NotFoundError,
} from "../services/tax.server";
import prisma from "../db.server";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draft } from "../services/claude.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { upgradeUrl } from "../lib/upgrade";
import { CopyPanel } from "../components/CopyPanel";
import { useEmailDelivery } from "../lib/use-email-delivery";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_TAX_VAT === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const [profiles] = await Promise.all([
    listProfilesForShop(session.shop),
  ]);
  // Validate ids for display (Growth workflow).
  const profilesWithValidation = profiles.map((p) => ({
    ...p,
    idValid: p.taxId ? validateTaxId(p.taxIdType as TaxIdType, p.taxId).valid : null,
  }));
  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());
  return {
    isGrowth: status.plan === GROWTH_PLAN,
    certWorkflow: taxCertWorkflowAllowed(status.plan),
    profiles: profilesWithValidation,
    access,
  };
};

type ActionResult =
  | { ok: true; message?: string; draft?: { companyId: string; reason: string }; copy?: { to: string; text: string } }
  | { ok: false; error: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // --- F14 dual-mode: Claude drafts a rejection reason; merchant sends --------
  if (intent === "ai-reject-note") {
    if (!taxCertWorkflowAllowed(status.plan)) return { ok: false, error: "That needs the Growth plan." };
    const { access, shop } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, upgrade: true, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    const companyId = String(form.get("companyId") ?? "");
    const { output } = await draft({
      feature: "tax_reject_note",
      shopId: shop.id,
      input: {
        companyName: String(form.get("companyName") ?? "this company"),
        taxIdType: String(form.get("taxIdType") ?? "") || null,
        hasCertificate: form.get("hasCertificate") === "on",
      },
    });
    return { ok: true, draft: { companyId, reason: typeof output.reason === "string" ? output.reason.trim() : "" } };
  }

  try {
    if (intent === "manual-exempt") {
      await setManualExempt(session.shop, String(form.get("companyId") ?? ""), form.get("exempt") === "on");
      return { ok: true, message: "Company tax status updated." };
    }
    // Growth-only below.
    if (!taxCertWorkflowAllowed(status.plan)) return { ok: false, error: "That needs the Growth plan." };
    if (intent === "verify") {
      await verifyTaxProfile(session.shop, String(form.get("companyId") ?? ""), form.get("exempt") === "on");
      return { ok: true, message: "Tax profile verified." };
    }
    if (intent === "reject") {
      const notice = await rejectTaxProfile(session.shop, String(form.get("companyId") ?? ""), String(form.get("reason") ?? ""));
      return notice && !notice.sent
        ? { ok: true, message: "Tax profile rejected.", copy: { to: notice.to, text: notice.text } }
        : { ok: true, message: "Tax profile rejected." };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "Company not found." };
    throw error;
  }
};

const STATUS_TONE: Record<string, "success" | "attention" | "critical"> = { VERIFIED: "success", UNVERIFIED: "attention", REJECTED: "critical" };
const STATUS_LABELS: Record<string, string> = { VERIFIED: "Verified", UNVERIFIED: "Not verified", REJECTED: "Rejected" };

function TaxRejectRow({
  p,
  access,
  divider,
}: {
  p: { companyId: string; companyName: string; taxIdType: string | null; hasCertificate: boolean };
  access: ClaudeAccess;
  divider: boolean;
}) {
  const draftFetcher = useFetcher<typeof action>();
  const drafting = draftFetcher.state !== "idle";
  const [reason, setReason] = useState("");
  const d = draftFetcher.data;
  const draft = d && d.ok && d.draft && d.draft.companyId === p.companyId ? d.draft : null;
  const draftErr = d && !d.ok ? d.error : null;

  return (
    <div>
      {divider && <Box borderBlockStartWidth="025" borderColor="border" />}
      <Box paddingBlock="300">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <Text as="span" fontWeight="semibold">{p.companyName}</Text>
            {access.allowed && (
              <Button
                size="slim"
                disabled={drafting}
                loading={drafting}
                onClick={() =>
                  draftFetcher.submit(
                    { intent: "ai-reject-note", companyId: p.companyId, companyName: p.companyName, taxIdType: p.taxIdType ?? "", hasCertificate: p.hasCertificate ? "on" : "" },
                    { method: "post" },
                  )
                }
              >
                ✦ Draft reason with Claude
              </Button>
            )}
          </InlineStack>

          {draftErr && <Banner tone="warning">{draftErr}</Banner>}
          {draft && (
            <Box background="bg-surface-secondary" borderRadius="200" padding="300">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">{draft.reason}</Text>
                <InlineStack gap="200">
                  <Button size="slim" variant="primary" onClick={() => setReason(draft.reason)}>Use this</Button>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Badge tone="info">✦ Drafted by Claude</Badge>
                  <Text as="span" variant="bodySm">{DRAFTED_BY_CLAUDE_TRUST}</Text>
                </InlineStack>
              </BlockStack>
            </Box>
          )}

          <Form method="post">
            <input type="hidden" name="intent" value="reject" />
            <input type="hidden" name="companyId" value={p.companyId} />
            <BlockStack gap="200">
              <TextField
                label={`Reason to send ${p.companyName}`}
                name="reason"
                value={reason}
                onChange={setReason}
                multiline={2}
                autoComplete="off"
                placeholder={
                  access.allowed
                    ? "Write what to re-submit, or draft a reason with Claude above."
                    : "Say what couldn't be verified and what to re-submit."
                }
              />
              <InlineStack>
                <Button size="slim" tone="critical" submit disabled={!reason.trim()}>Reject with this reason</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </BlockStack>
      </Box>
    </div>
  );
}

export default function TaxSettings() {
  const emailDelivery = useEmailDelivery();
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const busyIntent = busy ? String(nav.formData?.get("intent") ?? "") : "";
  const busyCompany = busy ? String(nav.formData?.get("companyId") ?? "") : "";

  const unverified = data.profiles.filter((p) => p.status === "UNVERIFIED");

  return (
    <Page>
      <TitleBar title="Tax & VAT" />
      <SectionTabs active="tax" />
      <BlockStack gap="500">
        {actionData?.ok === true && actionData.message && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === true && actionData.copy && (
          <CopyPanel
            title="Message for the buyer"
            description={`Mannon doesn’t deliver messages yet. Paste this into a message to ${actionData.copy.to} so they know what to re-submit.`}
            text={actionData.copy.text}
            toast="Message copied"
            copyLabel="Copy message"
          />
        )}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        {/* 1. Review queue: company tax profiles */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Company tax profiles</Text>
                {data.certWorkflow && unverified.length > 0 && <Badge tone="attention">{`${unverified.length} to review`}</Badge>}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Verify tax IDs and exemption certificates. Shopify calculates the tax — Mannon only sets
                who is exempt. Buyers are charged tax until you verify them.
              </Text>
            </BlockStack>
          </Box>
          {data.profiles.length === 0 ? (
            <EmptyState heading="No tax profiles yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Buyers add their tax ID or exemption certificate from their portal. Each one lands here for you to review.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "profile", plural: "profiles" }}
              itemCount={data.profiles.length}
              selectable={false}
              headings={[{ title: "Company" }, { title: "Tax ID" }, { title: "Status" }, { title: "Certificate" }, { title: "Actions" }]}
            >
              {data.profiles.map((p, i) => (
                <IndexTable.Row id={p.companyId} key={p.companyId} position={i}>
                  <IndexTable.Cell>{p.companyName}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {p.taxId ? (
                      <InlineStack gap="100" blockAlign="center" wrap>
                        <Text as="span">{p.taxIdType} {p.taxId}</Text>
                        {p.idValid === false && <Badge tone="critical">Invalid format</Badge>}
                        {p.idValid === true && <Badge tone="success">Valid format</Badge>}
                      </InlineStack>
                    ) : "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={STATUS_TONE[p.status] ?? "attention"}>{`${STATUS_LABELS[p.status] ?? p.status}${p.exempt ? " · Exempt" : ""}`}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {p.hasCertificate ? (
                      <PolarisLink url={`/app/tax/certificate/${p.companyId}`} target="_blank" accessibilityLabel={`Download ${p.companyName}'s certificate`}>Download</PolarisLink>
                    ) : "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {data.certWorkflow ? (
                      <InlineStack gap="150" wrap>
                        <Form method="post">
                          <input type="hidden" name="intent" value="verify" />
                          <input type="hidden" name="companyId" value={p.companyId} />
                          <input type="hidden" name="exempt" value="on" />
                          <Button submit size="micro" accessibilityLabel={`Verify ${p.companyName} as exempt`} loading={busyIntent === "verify" && busyCompany === p.companyId && nav.formData?.get("exempt") === "on"}>Verify exempt</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="verify" />
                          <input type="hidden" name="companyId" value={p.companyId} />
                          <Button submit size="micro" variant="tertiary" accessibilityLabel={`Verify ${p.companyName} as taxable`} loading={busyIntent === "verify" && busyCompany === p.companyId && nav.formData?.get("exempt") !== "on"}>Verify taxable</Button>
                        </Form>
                        <ConfirmAction
                          label="Reject"
                          size="micro"
                          variant="tertiary"
                          title={`Reject ${p.companyName}'s tax profile?`}
                          message="The buyer keeps paying tax and is asked to re-submit. To tell them why, use “Reject with a reason” below instead."
                          confirmLabel="Reject profile"
                          fields={{ intent: "reject", companyId: p.companyId }}
                        />
                      </InlineStack>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="manual-exempt" />
                        <input type="hidden" name="companyId" value={p.companyId} />
                        <input type="hidden" name="exempt" value={p.exempt ? "" : "on"} />
                        <Button submit size="micro" loading={busyIntent === "manual-exempt" && busyCompany === p.companyId}>{p.exempt ? "Remove exemption" : "Mark exempt"}</Button>
                      </Form>
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* 1b. Reject with a reason — right next to the queue (manual always works; Claude only pre-fills) */}
        {data.certWorkflow && unverified.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Reject with a reason</Text>
                  {data.access.state === "trial" && data.access.daysLeft != null && (
                    <Badge tone="attention">{`Claude trial · ${data.access.daysLeft} ${data.access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
                  )}
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  Tell a buyer why their exemption couldn’t be verified and what to re-submit. {emailDelivery ? "The buyer is emailed your reason." : "You get the message to send them."}
                </Text>
              </BlockStack>
              <BlockStack gap="0">
                {unverified.map((p, i) => (
                  <TaxRejectRow key={p.companyId} p={p} access={data.access as ClaudeAccess} divider={i > 0} />
                ))}
              </BlockStack>
              {!data.access.allowed && <UpgradeToClaude access={data.access as ClaudeAccess} upgradeUrl={upgradeUrl("growth")} />}
            </BlockStack>
          </Card>
        )}

        {/* 2. Where tax comes from — no field here: Shopify calculates it. */}
        <Card>
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">How tax is calculated</Text>
            <Text as="p" variant="bodyMd">
              Shopify calculates tax on every quote and order, using your Shopify tax settings and each
              company’s exemptions. Mannon never sets or adds a tax rate. Use this page to collect and verify
              exemption certificates.
            </Text>
          </BlockStack>
        </Card>

        {/* Per-region rules were removed: they never reached an order (the draft-order
            path has no company region to apply them to), so offering them misled. */}
      </BlockStack>
    </Page>
  );
}
