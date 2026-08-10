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
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { GROWTH_PLAN, agencyAllowed, AGENCY_UPGRADE_MESSAGE } from "../lib/billing";
import {
  WHITE_LABEL_ENABLED,
  getOrgForShop,
  getOrgRollup,
  createOrganization,
  linkStore,
  unlinkStore,
} from "../services/org.server";
import { canManage, roleLabel } from "../lib/org";
import { getBranding, saveBranding, NotAllowedError } from "../services/branding.server";
import { DEFAULT_PORTAL_NAME } from "../lib/branding";
import type { OrgRole } from "@prisma/client";

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

type ActionResult = { ok: boolean; error?: string; message?: string };

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
      case "link-store": {
        if (!org) return { ok: false, error: "Create your organization first." };
        const res = await linkStore(org.orgId, org.myRole, String(form.get("shop") ?? ""), (String(form.get("role") ?? "MANAGER") as OrgRole), baseUrl);
        return res.ok ? { ok: true, message: "Store linked." } : { ok: false, error: res.error };
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
            <Button url={`/app/settings?upgrade=${GROWTH_PLAN}`} variant="primary">See Growth</Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Agency" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        {!data.org ? (
          <CreateOrg shop={data.shop} busy={busy} />
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
                    <p>Link a client store below to see it here.</p>
                  </EmptyState>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "store", plural: "stores" }}
                    itemCount={data.rollup.stores.length}
                    selectable={false}
                    headings={[{ title: "Store" }, { title: "Role" }, { title: "Quotes" }, { title: "Accepted" }, { title: "Orders" }, { title: "Revenue" }, { title: "" }]}
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
                            <PolarisLink url={s.adminUrl} target="_blank">Open</PolarisLink>
                            {canManage(data.org!.myRole) && s.role !== "OWNER" && (
                              <Form method="post">
                                <input type="hidden" name="intent" value="unlink-store" />
                                <input type="hidden" name="shop" value={s.shop} />
                                <Button submit variant="tertiary" tone="critical" size="slim" disabled={busy}>Remove</Button>
                              </Form>
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
                    <LinkStoreForm busy={busy} />
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

function LinkStoreForm({ busy }: { busy: boolean }) {
  const [shop, setShop] = useState("");
  const [role, setRole] = useState("MANAGER");
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="link-store" />
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">Link a client store</Text>
        <Text as="p" tone="subdued" variant="bodySm">
          The store must have installed Mannon and be on its own Growth plan.
        </Text>
        <InlineStack gap="300" blockAlign="end" wrap>
          <Box minWidth="18rem">
            <TextField label="Store domain" name="shop" value={shop} onChange={setShop} autoComplete="off" placeholder="client.myshopify.com" />
          </Box>
          <Box minWidth="16rem">
            <Select label="Role" name="role" options={ROLE_OPTIONS} value={role} onChange={setRole} />
          </Box>
          <Button submit disabled={busy}>Link store</Button>
        </InlineStack>
      </BlockStack>
    </Form>
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
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">White-label this store’s buyer portal</Text>
        <Text as="p" tone="subdued" variant="bodyMd">
          Apply this client’s brand to their <b>buyer-facing</b> pages and emails only. The Shopify
          admin always stays Mannon. Colors are checked for readable contrast before they save.
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
    </Card>
  );
}
