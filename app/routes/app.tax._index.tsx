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
  Checkbox,
  IndexTable,
  EmptyState,
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { taxRegionsAllowed, taxCertWorkflowAllowed, GROWTH_PLAN } from "../lib/billing";
import { validateTaxId, type TaxIdType } from "../lib/tax";
import {
  listProfilesForShop,
  listRegionRules,
  upsertRegionRule,
  deleteRegionRule,
  getDefaultTaxRate,
  setDefaultTaxRate,
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

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_TAX_VAT === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const [profiles, regionRules, defaultRate] = await Promise.all([
    listProfilesForShop(session.shop),
    taxRegionsAllowed(status.plan) ? listRegionRules(session.shop) : Promise.resolve([]),
    getDefaultTaxRate(session.shop),
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
    regionsAllowed: taxRegionsAllowed(status.plan),
    certWorkflow: taxCertWorkflowAllowed(status.plan),
    profiles: profilesWithValidation,
    regionRules,
    defaultRatePct: defaultRate != null ? Math.round(defaultRate * 10000) / 100 : null,
    access,
  };
};

type ActionResult =
  | { ok: true; message?: string; draft?: { companyId: string; reason: string } }
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
    if (intent === "default-rate") {
      const raw = String(form.get("rate") ?? "").trim();
      const rate = raw === "" ? null : Number(raw) / 100;
      await setDefaultTaxRate(session.shop, rate);
      return { ok: true, message: "Default tax rate saved." };
    }
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
      await rejectTaxProfile(session.shop, String(form.get("companyId") ?? ""), String(form.get("reason") ?? ""));
      return { ok: true, message: "Tax profile rejected." };
    }
    if (intent === "region") {
      if (!taxRegionsAllowed(status.plan)) return { ok: false, error: "Per-region rules need Growth." };
      const rateRaw = String(form.get("rate") ?? "").trim();
      await upsertRegionRule(session.shop, { region: String(form.get("region") ?? ""), rate: rateRaw === "" ? null : Number(rateRaw) / 100, exemptByDefault: form.get("exemptByDefault") === "on" });
      return { ok: true, message: "Region rule saved." };
    }
    if (intent === "region-delete") {
      await deleteRegionRule(session.shop, String(form.get("id") ?? ""));
      return { ok: true, message: "Region rule removed." };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "Company not found." };
    throw error;
  }
};

const STATUS_TONE: Record<string, "success" | "attention" | "critical"> = { VERIFIED: "success", UNVERIFIED: "attention", REJECTED: "critical" };

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
                label="Reason to send the buyer"
                labelHidden
                name="reason"
                value={reason}
                onChange={setReason}
                multiline={2}
                autoComplete="off"
                placeholder="Draft a reason with Claude above, or write one here."
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
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [rate, setRate] = useState(data.defaultRatePct != null ? String(data.defaultRatePct) : "");
  const [region, setRegion] = useState("");
  const [regionRate, setRegionRate] = useState("");
  const [regionExempt, setRegionExempt] = useState(false);
  const unverified = data.profiles.filter((p) => p.status === "UNVERIFIED");

  return (
    <Page>
      <TitleBar title="Tax & VAT" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        <Text as="p" tone="subdued" variant="bodyMd">
          Collect exemption documents, verify tax IDs, and apply the right tax at
          checkout. Mannon never computes tax — Shopify does; we set exemptions and
          keep your invoices compliant. Buyers are <b>charged tax until verified</b>.
        </Text>

        {/* Default rate (both plans) */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="default-rate" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Default tax rate</Text>
              <Text as="p" tone="subdued" variant="bodySm">A reference rate shown on quotes/invoices (e.g. KSA 15%, UAE 5%). Shopify still calculates the actual tax.</Text>
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="180px"><TextField label="Default rate" name="rate" type="number" value={rate} onChange={setRate} min={0} max={100} suffix="%" autoComplete="off" /></Box>
                <Button submit loading={busy}>Save rate</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* Per-region rules (Growth) */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">Per-region rules</Text>
              {!data.regionsAllowed && <Badge tone="info">Growth</Badge>}
            </InlineStack>
            {data.regionsAllowed ? (
              <>
                <Form method="post">
                  <input type="hidden" name="intent" value="region" />
                  <InlineStack gap="300" blockAlign="end" wrap>
                    <Box minWidth="140px"><TextField label="Region" name="region" value={region} onChange={setRegion} autoComplete="off" placeholder="SA, AE, EU, US-CA" /></Box>
                    <Box minWidth="140px"><TextField label="Rate %" name="rate" type="number" value={regionRate} onChange={setRegionRate} min={0} max={100} suffix="%" autoComplete="off" /></Box>
                    <Checkbox label="Exempt by default" name="exemptByDefault" checked={regionExempt} onChange={setRegionExempt} />
                    <Button submit loading={busy}>Add / update</Button>
                  </InlineStack>
                </Form>
                {data.regionRules.length > 0 && (
                  <BlockStack gap="150">
                    {data.regionRules.map((r) => (
                      <InlineStack key={r.id} align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm">{r.region} · {r.rate != null ? `${Math.round(Number(r.rate) * 10000) / 100}%` : "—"} {r.exemptByDefault ? "· exempt by default" : ""}</Text>
                        <Form method="post">
                          <input type="hidden" name="intent" value="region-delete" />
                          <input type="hidden" name="id" value={r.id} />
                          <Button submit variant="tertiary" tone="critical" size="micro" loading={busy}>Remove</Button>
                        </Form>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </>
            ) : (
              <Text as="p" tone="subdued" variant="bodySm">Per-region VAT/GST rules are a Growth feature. Starter uses the single default rate + a manual exempt toggle per company.</Text>
            )}
          </BlockStack>
        </Card>

        {/* Reject with a considered (Claude-drafted) reason */}
        {data.certWorkflow && unverified.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Reject with a reason</Text>
                {data.access.state === "trial" && data.access.daysLeft != null && (
                  <Badge tone="attention">{`Claude trial · ${data.access.daysLeft} ${data.access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
                )}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Tell a buyer why their exemption couldn’t be verified and what to re-submit. Draft it with Claude, review, then reject — the buyer is emailed your reason.
              </Text>
              {!data.access.allowed && <UpgradeToClaude access={data.access as ClaudeAccess} upgradeUrl="/app/settings" />}
              <BlockStack gap="0">
                {unverified.map((p, i) => (
                  <TaxRejectRow key={p.companyId} p={p} access={data.access as ClaudeAccess} divider={i > 0} />
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* Company profiles / review queue */}
        <Card padding="0">
          <Box padding="400"><Text as="h2" variant="headingMd">Company tax profiles</Text></Box>
          {data.profiles.length === 0 ? (
            <EmptyState heading="No tax profiles yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Buyers submit their tax ID or exemption certificate from their portal.</p>
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
                      <>
                        {p.taxIdType} {p.taxId}{" "}
                        {p.idValid === false && <Badge tone="critical">bad format</Badge>}
                        {p.idValid === true && <Badge tone="success">valid</Badge>}
                      </>
                    ) : "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={STATUS_TONE[p.status] ?? "attention"}>{`${p.status}${p.exempt ? " · exempt" : ""}`}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {p.hasCertificate ? (
                      <PolarisLink url={`/app/tax/certificate/${p.companyId}`} target="_blank">Download</PolarisLink>
                    ) : "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {data.certWorkflow ? (
                      <InlineStack gap="150" wrap>
                        <Form method="post">
                          <input type="hidden" name="intent" value="verify" />
                          <input type="hidden" name="companyId" value={p.companyId} />
                          <input type="hidden" name="exempt" value="on" />
                          <Button submit size="micro" loading={busy}>Verify exempt</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="verify" />
                          <input type="hidden" name="companyId" value={p.companyId} />
                          <Button submit size="micro" variant="tertiary" loading={busy}>Verify taxable</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="reject" />
                          <input type="hidden" name="companyId" value={p.companyId} />
                          <Button submit size="micro" tone="critical" variant="tertiary" loading={busy}>Reject</Button>
                        </Form>
                      </InlineStack>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="manual-exempt" />
                        <input type="hidden" name="companyId" value={p.companyId} />
                        <input type="hidden" name="exempt" value={p.exempt ? "" : "on"} />
                        <Button submit size="micro" loading={busy}>{p.exempt ? "Remove exemption" : "Mark exempt"}</Button>
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
