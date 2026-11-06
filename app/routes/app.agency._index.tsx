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
  EmptyState,
  Link as PolarisLink,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { ConfirmAction } from "../components/ConfirmAction";
import { DisclosureCard } from "../components/DisclosureCard";
import { formatDate } from "../lib/format";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { GROWTH_PLAN, agencyAllowed, AGENCY_UPGRADE_MESSAGE } from "../lib/billing";
import {
  WHITE_LABEL_ENABLED,
  getOrgForShop,
  getOrgRollup,
  createOrganization,
  createStoreInvite,
  joinWithInvite,
  unlinkStore,
} from "../services/org.server";
import { canManage, roleLabel } from "../lib/org";
import { getBranding, saveBranding, NotAllowedError } from "../services/branding.server";
import { DEFAULT_PORTAL_NAME } from "../lib/branding";
import type { OrgRole } from "@prisma/client";
import { upgradeUrl } from "../lib/upgrade";

const IS_TEST = process.env.NODE_ENV !== "production";

function fmtRevenue(rev: Array<{ amount: string; currencyCode: string }>): string {
  if (rev.length === 0) return "—";
  return rev.map((r) => `${r.currencyCode} ${r.amount}`).join(" · ");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!WHITE_LABEL_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const allowed = agencyAllowed(status.plan);
  if (!allowed) {
    return { locked: true, shop: session.shop, org: null, rollup: null, branding: null, appUrl: "", upgradeMessage: AGENCY_UPGRADE_MESSAGE };
  }

  const org = await getOrgForShop(session.shop);
  const rollup = org ? await getOrgRollup(org.orgId) : null;
  const branding = await getBranding(session.shop);
  const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  return {
    locked: false,
    shop: session.shop,
    org,
    rollup,
    branding: branding
      ? { primaryColor: branding.primaryColor, accentColor: branding.accentColor, portalName: branding.portalName, logoFileId: branding.logoFileId }
      : null,
    appUrl,
    upgradeMessage: AGENCY_UPGRADE_MESSAGE,
  };
};

type ActionResult = { ok: boolean; error?: string; message?: string; invite?: { code: string; expiresAt: string; role: string } };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!WHITE_LABEL_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!agencyAllowed(status.plan)) return { ok: false, error: AGENCY_UPGRADE_MESSAGE };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const org = await getOrgForShop(session.shop);

  try {
    switch (intent) {
      case "create-org": {
        const res = await createOrganization(
          String(form.get("name") ?? ""),
          String(form.get("ownerEmail") ?? ""),
          session.shop,
          status.plan,
        );
        return "error" in res ? { ok: false, error: res.error } : { ok: true, message: "Agency workspace created." };
      }
      case "create-invite": {
        if (!org) return { ok: false, error: "Create your organization first." };
        const role = String(form.get("role") ?? "MANAGER") as OrgRole;
        const res = await createStoreInvite(org.orgId, org.myRole, role);
        return res.ok
          ? { ok: true, invite: { code: res.code, expiresAt: res.expiresAt.toISOString(), role: roleLabel(role === "VIEWER" ? "VIEWER" : "MANAGER") } }
          : { ok: false, error: res.error };
      }
      case "join-org": {
        // The joining store is always this signed-in store; no store domain is ever typed (App Store 2.3.1).
        if (org) return { ok: false, error: "This store is already part of an organization." };
        const res = await joinWithInvite(session.shop, String(form.get("code") ?? ""), baseUrl);
        return res.ok ? { ok: true, message: `This store joined ${res.orgName}.` } : { ok: false, error: res.error };
      }
      case "unlink-store": {
        if (!org) return { ok: false, error: "No organization." };
        const res = await unlinkStore(org.orgId, org.myRole, String(form.get("shop") ?? ""));
        return res.ok ? { ok: true, message: "Store removed from the organization." } : { ok: false, error: res.error };
      }
      case "save-branding": {
        if (org && !canManage(org.myRole)) return { ok: false, error: "You don’t have permission to edit branding." };
        const res = await saveBranding(
          session.shop,
          {
            primaryColor: form.get("primaryColor"),
            accentColor: form.get("accentColor"),
            portalName: form.get("portalName"),
            logoFileId: form.get("logoFileId"),
          },
          status.plan,
        );
        return res.ok ? { ok: true, message: "Buyer-portal branding saved." } : { ok: false, error: res.error };
      }
      default:
        return { ok: false, error: "Unknown action." };
    }
  } catch (error) {
    if (error instanceof NotAllowedError) return { ok: false, error: error.message };
    throw error;
  }
};

const ROLE_OPTIONS = [
  { label: "Manager — can manage stores & branding", value: "MANAGER" },
  { label: "Viewer — read-only rollups", value: "VIEWER" },
];

export default function Agency() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  if (data.locked) {
    return (
      <Page>
        <TitleBar title="Agency" />
        <SectionTabs active="agency" />
        <Banner tone="info" title="Manage & white-label multiple stores">
          <p>{data.upgradeMessage}</p>
          <Box paddingBlockStart="200">
            <Button url={upgradeUrl(GROWTH_PLAN)} variant="primary">See Growth</Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Agency" />
      <SectionTabs active="agency" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        {!data.org ? (
          <>
            <JoinOrg busy={busy} />
            <CreateOrg shop={data.shop} busy={busy} />
          </>
        ) : (
          <>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{data.org.name}</Text>
                  <Badge tone="info">{roleLabel(data.org.myRole)}</Badge>
                </InlineStack>
                {data.rollup && (
                  <InlineStack gap="400" wrap>
                    <Metric label="Stores" value={String(data.rollup.stores.length)} />
                    <Metric label="Quotes sent" value={String(data.rollup.totals.quotesSent)} />
                    <Metric label="Accepted" value={String(data.rollup.totals.quotesAccepted)} />
                    <Metric label="Orders" value={String(data.rollup.totals.orders)} />
                    <Metric label="Revenue" value={fmtRevenue(data.rollup.totals.revenue)} />
                  </InlineStack>
                )}
                <Text as="p" tone="subdued" variant="bodySm">
                  Rollups combine each store’s own metrics — data never crosses stores, and each store
                  bills separately through Shopify.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Connected stores</Text>
                {!data.rollup || data.rollup.stores.length === 0 ? (
                  <EmptyState heading="No stores yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                    <p>Client stores show up here once their owner joins with an invite code. Create one below.</p>
                  </EmptyState>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "store", plural: "stores" }}
                    itemCount={data.rollup.stores.length}
                    selectable={false}
                    headings={[{ title: "Store" }, { title: "Role" }, { title: "Quotes" }, { title: "Accepted" }, { title: "Orders" }, { title: "Revenue" }, { title: "Actions", hidden: true }]}
                  >
                    {data.rollup.stores.map((s, i) => (
                      <IndexTable.Row id={s.shop} key={s.shop} position={i}>
                        <IndexTable.Cell>
                          <InlineStack gap="150" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">{s.shop}</Text>
                            {!s.installed && <Badge tone="warning">Not installed</Badge>}
                          </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{roleLabel(s.role)}</IndexTable.Cell>
                        <IndexTable.Cell>{s.quotesSent}</IndexTable.Cell>
                        <IndexTable.Cell>{s.quotesAccepted}</IndexTable.Cell>
                        <IndexTable.Cell>{s.orders}</IndexTable.Cell>
                        <IndexTable.Cell>{fmtRevenue(s.revenue)}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="200">
                            <PolarisLink url={s.adminUrl} target="_blank" accessibilityLabel={`Open ${s.shop} admin`}>Open</PolarisLink>
                            {canManage(data.org!.myRole) && s.role !== "OWNER" && (
                              <ConfirmAction
                                label="Remove"
                                variant="tertiary"
                                size="slim"
                                disabled={busy}
                                title={`Remove ${s.shop}?`}
                                message="The store leaves your organization and drops out of your rollups. Its own data, branding and billing aren't changed."
                                confirmLabel="Remove store"
                                fields={{ intent: "unlink-store", shop: s.shop }}
                              />
                            )}
                          </InlineStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}

                {canManage(data.org.myRole) && (
                  <>
                    <Divider />
                    <InviteStoreForm busy={busy} invite={actionData?.invite ?? null} />
                  </>
                )}
              </BlockStack>
            </Card>

            <BrandingCard shop={data.shop} branding={data.branding} appUrl={data.appUrl} canEdit={canManage(data.org.myRole)} busy={busy} />
          </>
        )}
      </BlockStack>
    </Page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="050">
      <Text as="span" tone="subdued" variant="bodySm">{label}</Text>
      <Text as="span" variant="headingLg">{value}</Text>
    </BlockStack>
  );
}

function CreateOrg({ shop, busy }: { shop: string; busy: boolean }) {
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Create your agency workspace</Text>
        <Text as="p" tone="subdued" variant="bodyMd">
          Manage every client store from one place — cross-store rollups, quick switching, and
          per-store white-label branding. This store ({shop}) becomes the owner. Each managed store
          keeps its own Growth subscription.
        </Text>
        <Form method="post">
          <input type="hidden" name="intent" value="create-org" />
          <BlockStack gap="300">
            <TextField label="Organization name" name="name" value={name} onChange={setName} autoComplete="off" placeholder="e.g. Northwind Agency" />
            <TextField label="Owner email" name="ownerEmail" type="email" value={ownerEmail} onChange={setOwnerEmail} autoComplete="off" placeholder="you@agency.com" />
            <Box>
              <Button submit variant="primary" disabled={busy}>Create workspace</Button>
            </Box>
          </BlockStack>
        </Form>
      </BlockStack>
    </Card>
  );
}

function InviteStoreForm({ busy, invite }: { busy: boolean; invite: { code: string; expiresAt: string; role: string } | null }) {
  const [role, setRole] = useState("MANAGER");
  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingSm">Add a client store</Text>
      <Text as="p" tone="subdued" variant="bodySm">
        Create an invite code and send it to the store’s owner. They join from inside their own
        Mannon, so a store is only added with its owner’s consent. The store needs Mannon installed
        from the Shopify App Store and its own Growth plan.
      </Text>
      <Form method="post">
        <input type="hidden" name="intent" value="create-invite" />
        <InlineStack gap="300" blockAlign="end" wrap>
          <Box minWidth="16rem">
            <Select label="Their role" name="role" options={ROLE_OPTIONS.filter((o) => o.value !== "OWNER")} value={role} onChange={setRole} />
          </Box>
          <Button submit disabled={busy}>Create invite code</Button>
        </InlineStack>
      </Form>
      {invite && (
        <Banner tone="success" title="Invite code ready to send">
          <BlockStack gap="200">
            <Text as="p" variant="headingMd"><code>{invite.code}</code></Text>
            <Text as="p">
              Role: {invite.role}. Single use; expires {formatDate(invite.expiresAt)}. It isn’t shown again.
            </Text>
            <Text as="p">
              The store owner opens <strong>Apps → Mannon → Settings → Agency</strong> in their Shopify admin,
              chooses <strong>Join an organization</strong> and enters the code.
            </Text>
          </BlockStack>
        </Banner>
      )}
    </BlockStack>
  );
}

function JoinOrg({ busy }: { busy: boolean }) {
  const [code, setCode] = useState("");
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Join an organization</Text>
        <Text as="p" tone="subdued" variant="bodyMd">
          Did an agency or your head office send you an invite code? Enter it to add this store to
          their organization. They’ll see this store’s quote and order totals; each store keeps its
          own data and billing.
        </Text>
        <Form method="post">
          <input type="hidden" name="intent" value="join-org" />
          <InlineStack gap="300" blockAlign="end" wrap>
            <Box minWidth="18rem">
              <TextField label="Invite code" name="code" value={code} onChange={setCode} autoComplete="off" placeholder="MNN-XXXX-XXXX-XXXX" />
            </Box>
            <Button submit disabled={busy || !code.trim()}>Join organization</Button>
          </InlineStack>
        </Form>
      </BlockStack>
    </Card>
  );
}

function BrandingCard({
  shop,
  branding,
  appUrl,
  canEdit,
  busy,
}: {
  shop: string;
  branding: { primaryColor: string | null; accentColor: string | null; portalName: string | null; logoFileId: string | null } | null;
  appUrl: string;
  canEdit: boolean;
  busy: boolean;
}) {
  const [primaryColor, setPrimaryColor] = useState(branding?.primaryColor ?? "");
  const [accentColor, setAccentColor] = useState(branding?.accentColor ?? "");
  const [portalName, setPortalName] = useState(branding?.portalName ?? "");
  const [logoFileId, setLogoFileId] = useState(branding?.logoFileId ?? "");
  const hasBranding = Boolean(branding?.portalName || branding?.primaryColor || branding?.accentColor || branding?.logoFileId);
  return (
    <DisclosureCard
      title="White-label this store’s buyer portal"
      subtitle="Apply this client’s brand to buyer-facing pages and emails. The Shopify admin always stays Mannon."
      badge={hasBranding ? <Badge tone="success">Customized</Badge> : undefined}
      defaultOpen={!hasBranding && canEdit}
    >
      <BlockStack gap="300">
        <Text as="p" tone="subdued" variant="bodySm">
          Colors are checked for readable contrast before they save.
          {!canEdit ? " You have view-only access, so you can't change branding." : ""}
        </Text>
        <Form method="post">
          <input type="hidden" name="intent" value="save-branding" />
          <BlockStack gap="300">
            <InlineStack gap="300" wrap>
              <Box minWidth="14rem">
                <TextField label="Portal name" name="portalName" value={portalName} onChange={setPortalName} autoComplete="off" placeholder={DEFAULT_PORTAL_NAME} disabled={!canEdit} />
              </Box>
              <Box minWidth="12rem">
                <TextField label="Primary color (hex)" name="primaryColor" value={primaryColor} onChange={setPrimaryColor} autoComplete="off" placeholder="#4F46E5" disabled={!canEdit} />
              </Box>
              <Box minWidth="12rem">
                <TextField label="Accent color (hex)" name="accentColor" value={accentColor} onChange={setAccentColor} autoComplete="off" placeholder="#A3E635" disabled={!canEdit} />
              </Box>
              <Box minWidth="16rem">
                <TextField label="Logo file id (optional)" name="logoFileId" value={logoFileId} onChange={setLogoFileId} autoComplete="off" placeholder="gid://shopify/…" disabled={!canEdit} />
              </Box>
            </InlineStack>
            <InlineStack gap="300" blockAlign="center">
              <Button submit variant="primary" disabled={busy || !canEdit}>Save branding</Button>
              <PolarisLink url={`${appUrl}/portal`} target="_blank">Preview buyer portal</PolarisLink>
            </InlineStack>
          </BlockStack>
        </Form>
      </BlockStack>
    </DisclosureCard>
  );
}
