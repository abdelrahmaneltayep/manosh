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
  Select,
  IndexTable,
  EmptyState,
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { GROWTH_PLAN, catalogSharingAllowed, CATALOG_SHARE_UPGRADE_MESSAGE } from "../lib/billing";
import { listCatalogs } from "../services/catalogs.server";
import {
  CATALOG_SHARE_ENABLED,
  listPublicCatalogs,
  listLeads,
  createPublicCatalog,
  updatePublicCatalog,
  setPublished,
  deletePublicCatalog,
  approveLead,
  declineLead,
  NotAllowedError,
} from "../services/public-catalog.server";
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
import { draft } from "../services/claude.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";

const IS_TEST = process.env.NODE_ENV !== "production";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!CATALOG_SHARE_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const allowed = catalogSharingAllowed(status.plan);
  const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  const [publicCatalogs, catalogs, leads] = allowed
    ? await Promise.all([listPublicCatalogs(session.shop), listCatalogs(session.shop), listLeads(session.shop)])
    : [[], [], []];

  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());

  return {
    locked: !allowed,
    upgradeMessage: CATALOG_SHARE_UPGRADE_MESSAGE,
    shop: session.shop,
    appUrl,
    publicCatalogs,
    catalogs: catalogs.map((c) => ({ id: c.id, name: c.name, itemCount: c.itemCount })),
    leads,
    access,
  };
};

type ActionResult = { ok: boolean; error?: string; message?: string; draft?: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!CATALOG_SHARE_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!catalogSharingAllowed(status.plan)) {
    return { ok: false, error: CATALOG_SHARE_UPGRADE_MESSAGE };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  // --- F19 dual-mode: Claude drafts the public catalog title -----------------
  if (intent === "ai-catalog-title") {
    const { access, shop } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, upgrade: true, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    const { output } = await draft({
      feature: "catalog_title",
      shopId: shop.id,
      input: { catalogName: String(form.get("catalogName") ?? ""), currentTitle: String(form.get("currentTitle") ?? "") },
    });
    return { ok: true, draft: typeof output.title === "string" ? output.title.trim() : "" };
  }

  try {
    switch (intent) {
      case "create": {
        await createPublicCatalog(
          session.shop,
          { catalogId: String(form.get("catalogId") ?? ""), title: String(form.get("title") ?? "") },
          status.plan,
        );
        return { ok: true, message: "Draft catalog created. Publish it when you’re ready." };
      }
      case "update": {
        await updatePublicCatalog(session.shop, String(form.get("id") ?? ""), {
          visibility: (String(form.get("visibility") ?? "") as "LINK" | "LISTED") || undefined,
          showPrices: (String(form.get("showPrices") ?? "") as "HIDDEN" | "AFTER_APPROVAL" | "PUBLIC") || undefined,
        });
        return { ok: true, message: "Settings saved." };
      }
      case "publish":
        await setPublished(session.shop, String(form.get("id") ?? ""), true);
        return { ok: true, message: "Catalog is live." };
      case "unpublish":
        await setPublished(session.shop, String(form.get("id") ?? ""), false);
        return { ok: true, message: "Catalog unlisted. The public page is now offline." };
      case "delete":
        await deletePublicCatalog(session.shop, String(form.get("id") ?? ""));
        return { ok: true, message: "Public catalog removed." };
      case "approve-lead": {
        const res = await approveLead(session.shop, String(form.get("leadId") ?? ""), session.shop, baseUrl);
        return res.ok ? { ok: true, message: "Approved — the buyer has been emailed a secure link." } : { ok: false, error: res.error };
      }
      case "decline-lead": {
        const res = await declineLead(session.shop, String(form.get("leadId") ?? ""));
        return res.ok ? { ok: true, message: "Lead declined." } : { ok: false, error: res.error };
      }
      default:
        return { ok: false, error: "Unknown action." };
    }
  } catch (error) {
    if (error instanceof NotAllowedError) return { ok: false, error: error.message };
    throw error;
  }
};

const PRICE_OPTIONS = [
  { label: "Hidden — prices shared only with approved buyers", value: "HIDDEN" },
  { label: "After approval — unlock in the portal once approved", value: "AFTER_APPROVAL" },
  { label: "Public — show reference prices on the page", value: "PUBLIC" },
];
const VIS_OPTIONS = [
  { label: "Link only (unlisted)", value: "LINK" },
  { label: "Listed in the Mannon discovery index", value: "LISTED" },
];

export default function CatalogSharing() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [catalogId, setCatalogId] = useState(data.catalogs[0]?.id ?? "");
  const [title, setTitle] = useState("");

  // Dual-mode: Claude drafts the public catalog title.
  const titleFetcher = useFetcher<typeof action>();
  const draftingTitle = titleFetcher.state !== "idle";
  const titleData = titleFetcher.data;
  const titleDraft = titleData && titleData.ok && typeof titleData.draft === "string" ? titleData.draft : null;
  const titleErr = titleData && !titleData.ok ? titleData.error : null;
  const access = data.access as ClaudeAccess;

  if (data.locked) {
    return (
      <Page>
        <TitleBar title="Catalog sharing" />
        <SectionTabs active="catalog-sharing" />
        <Banner tone="info" title="Publish a shareable wholesale catalog">
          <p>{data.upgradeMessage}</p>
          <Box paddingBlockStart="200">
            <Button url={`/app/settings?upgrade=${GROWTH_PLAN}`} variant="primary">See Growth</Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  const catalogOptions = data.catalogs.map((c) => ({ label: `${c.name} (${c.itemCount} items)`, value: c.id }));

  return (
    <Page>
      <TitleBar title="Catalog sharing" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Publish a catalog</Text>
            <Text as="p" tone="subdued" variant="bodyMd">
              Turn one of your custom catalogs (F11) into a branded public page new buyers
              can browse and request access to. Prices are hidden by default; hidden SKUs
              never appear.
            </Text>
            {data.catalogs.length === 0 ? (
              <Banner tone="warning">
                Create a custom catalog first (Catalogs), then publish it here.
              </Banner>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <BlockStack gap="200">
                  <InlineStack gap="300" blockAlign="end" wrap>
                    <Box minWidth="16rem">
                      <Select label="Catalog" options={catalogOptions} value={catalogId} onChange={setCatalogId} name="catalogId" />
                    </Box>
                    <Box minWidth="16rem">
                      <TextField label="Public title" value={title} onChange={setTitle} name="title" autoComplete="off" placeholder="e.g. Spring 2026 wholesale" />
                    </Box>
                    <Button submit variant="primary" disabled={busy}>Create draft</Button>
                  </InlineStack>

                  {access.state === "trial" && access.daysLeft != null && (
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone="attention">{`Claude trial · ${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
                    </InlineStack>
                  )}
                  {access.allowed ? (
                    <BlockStack gap="200">
                      <InlineStack>
                        <Button
                          size="slim"
                          disabled={draftingTitle}
                          loading={draftingTitle}
                          onClick={() =>
                            titleFetcher.submit(
                              { intent: "ai-catalog-title", catalogName: data.catalogs.find((c) => c.id === catalogId)?.name ?? "", currentTitle: title },
                              { method: "post" },
                            )
                          }
                        >
                          ✦ Draft title with Claude
                        </Button>
                      </InlineStack>
                      {titleErr && <Banner tone="warning">{titleErr}</Banner>}
                      {titleDraft && (
                        <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{titleDraft}</Text>
                            <InlineStack gap="200">
                              <Button size="slim" variant="primary" onClick={() => setTitle(titleDraft)}>Use this</Button>
                            </InlineStack>
                            <InlineStack gap="200" blockAlign="center" wrap>
                              <Badge tone="info">✦ Drafted by Claude</Badge>
                              <Text as="span" variant="bodySm">{DRAFTED_BY_CLAUDE_TRUST}</Text>
                            </InlineStack>
                          </BlockStack>
                        </Box>
                      )}
                    </BlockStack>
                  ) : (
                    <UpgradeToClaude access={access} upgradeUrl="/app/settings" />
                  )}
                </BlockStack>
              </Form>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Your public catalogs</Text>
            {data.publicCatalogs.length === 0 ? (
              <EmptyState heading="No public catalogs yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Publish a catalog above to get a shareable wholesale page.</p>
              </EmptyState>
            ) : (
              <BlockStack gap="400">
                {data.publicCatalogs.map((pc) => (
                  <PublicCatalogCard key={pc.id} pc={pc} publicUrl={`${data.appUrl}/catalog/${data.shop}/${pc.slug}`} busy={busy} />
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Access requests</Text>
            {data.leads.length === 0 ? (
              <Text as="p" tone="subdued" variant="bodyMd">
                No requests yet. When a visitor asks for access, they’ll appear here — approving
                one provisions their account and unlocks their prices.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "request", plural: "requests" }}
                itemCount={data.leads.length}
                selectable={false}
                headings={[{ title: "Company" }, { title: "Email" }, { title: "Catalog" }, { title: "Received" }, { title: "Status" }, { title: "" }]}
              >
                {data.leads.map((lead, i) => (
                  <IndexTable.Row id={lead.id} key={lead.id} position={i}>
                    <IndexTable.Cell>{lead.companyName ?? "—"}</IndexTable.Cell>
                    <IndexTable.Cell>{lead.email}</IndexTable.Cell>
                    <IndexTable.Cell>{lead.catalogTitle}</IndexTable.Cell>
                    <IndexTable.Cell>{formatDate(lead.createdAt)}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={lead.status === "APPROVED" ? "success" : lead.status === "DECLINED" ? undefined : "attention"}>
                        {lead.status === "NEW" ? "New" : lead.status === "APPROVED" ? "Approved" : "Declined"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {lead.status === "NEW" && (
                        <InlineStack gap="200">
                          <Form method="post"><input type="hidden" name="intent" value="approve-lead" /><input type="hidden" name="leadId" value={lead.id} /><Button submit size="slim" variant="primary" disabled={busy}>Approve</Button></Form>
                          <Form method="post"><input type="hidden" name="intent" value="decline-lead" /><input type="hidden" name="leadId" value={lead.id} /><Button submit size="slim" disabled={busy}>Decline</Button></Form>
                        </InlineStack>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

type PublicCatalogItem = Awaited<ReturnType<typeof loader>>["publicCatalogs"][number];

function PublicCatalogCard({ pc, publicUrl, busy }: { pc: PublicCatalogItem; publicUrl: string; busy: boolean }) {
  const [showPrices, setShowPrices] = useState(pc.showPrices);
  const [visibility, setVisibility] = useState(pc.visibility);
  return (
    <Box padding="300" borderColor="border" borderWidth="025" borderRadius="200">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="headingSm">{pc.title}</Text>
            <Badge tone={pc.status === "LIVE" ? "success" : undefined}>{pc.status === "LIVE" ? "Live" : "Draft"}</Badge>
            {pc.newLeadCount > 0 && <Badge tone="attention">{`${pc.newLeadCount} new request${pc.newLeadCount === 1 ? "" : "s"}`}</Badge>}
          </InlineStack>
          <Text as="span" tone="subdued" variant="bodySm">from {pc.catalogName}</Text>
        </InlineStack>

        {pc.status === "LIVE" && (
          <Text as="p" variant="bodySm">
            Public link: <PolarisLink url={publicUrl} target="_blank">{publicUrl}</PolarisLink>
          </Text>
        )}

        <Form method="post">
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="id" value={pc.id} />
          <InlineStack gap="300" blockAlign="end" wrap>
            <Box minWidth="18rem">
              <Select label="Prices" name="showPrices" options={PRICE_OPTIONS} value={showPrices} onChange={(v) => setShowPrices(v as typeof showPrices)} />
            </Box>
            <Box minWidth="16rem">
              <Select label="Visibility" name="visibility" options={VIS_OPTIONS} value={visibility} onChange={(v) => setVisibility(v as typeof visibility)} />
            </Box>
            <Button submit disabled={busy}>Save</Button>
          </InlineStack>
        </Form>

        <InlineStack gap="200">
          {pc.status === "LIVE" ? (
            <Form method="post"><input type="hidden" name="intent" value="unpublish" /><input type="hidden" name="id" value={pc.id} /><Button submit disabled={busy}>Unlist</Button></Form>
          ) : (
            <Form method="post"><input type="hidden" name="intent" value="publish" /><input type="hidden" name="id" value={pc.id} /><Button submit variant="primary" disabled={busy}>Publish</Button></Form>
          )}
          <Form method="post"><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={pc.id} /><Button submit tone="critical" variant="tertiary" disabled={busy}>Delete</Button></Form>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}
