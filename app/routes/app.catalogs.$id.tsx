import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Banner,
  Button,
  Box,
  TextField,
  Select,
  IndexTable,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { catalogAssignmentScopes, catalogCsvAllowed, GROWTH_PLAN } from "../lib/billing";
import { getCatalog } from "../services/catalog.server";
import {
  getCatalogDetail,
  renameCatalog,
  setVisibility,
  replaceCatalogItems,
  assignCatalog,
  removeAssignment,
  parseCatalogCsv,
  importCatalogCsv,
  previewVisibleCatalog,
  ScopeNotAllowedError,
  NotFoundError,
} from "../services/catalogs.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_CUSTOM_CATALOGS === "true";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const catalogId = params.id!;

  const detail = await getCatalogDetail(session.shop, catalogId);
  if (!detail) throw new Response("Catalog not found", { status: 404 });

  let products: Array<{ productId: string; variantId: string; title: string; sku: string | null }> = [];
  let catalogError = false;
  try {
    const full = await getCatalog(session.shop);
    products = full.map((p) => ({ productId: p.productId, variantId: p.variantId, title: p.displayTitle, sku: p.sku }));
  } catch {
    catalogError = true;
  }

  const companies = await prisma.company.findMany({
    where: { shop: { shopifyDomain: session.shop } },
    select: { id: true, name: true, buyers: { select: { id: true, email: true } } },
    orderBy: { name: "asc" },
    take: 100,
  });

  // Preview-as-customer.
  const url = new URL(request.url);
  const previewCompany = url.searchParams.get("company") || undefined;
  const previewMember = url.searchParams.get("member") || undefined;
  let preview: { items: Array<{ variantId: string; title: string }>; total: number } | null = null;
  if (previewCompany || previewMember) {
    const res = await previewVisibleCatalog(session.shop, { companyId: previewCompany, memberId: previewMember });
    preview = { items: res.items.map((i) => ({ variantId: i.variantId, title: i.displayTitle })), total: res.total };
  }

  return {
    detail,
    products,
    catalogError,
    companies,
    isGrowth: status.plan === GROWTH_PLAN,
    scopes: catalogAssignmentScopes(status.plan),
    csvAllowed: catalogCsvAllowed(status.plan),
    preview,
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<Response | ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const catalogId = params.id!;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "rename") {
      await renameCatalog(session.shop, catalogId, String(form.get("name") ?? ""));
      return { ok: true, message: "Catalog renamed." };
    }
    if (intent === "visibility") {
      await setVisibility(session.shop, catalogId, String(form.get("visibility") ?? "ASSIGNED") === "ALL" ? "ALL" : "ASSIGNED");
      return { ok: true, message: "Visibility updated." };
    }
    if (intent === "save-items") {
      const hidden = String(form.get("mode") ?? "") === "ALL";
      const checked = form.getAll("pick").map((raw) => {
        const [productId, variantId] = String(raw).split("||");
        return { productId, variantId: variantId || null };
      });
      await replaceCatalogItems(session.shop, catalogId, checked, hidden);
      return { ok: true, message: `Saved ${checked.length} product(s).` };
    }
    if (intent === "assign") {
      await assignCatalog(
        session.shop,
        {
          catalogId,
          scope: String(form.get("scope") ?? "COMPANY") as "COMPANY" | "GROUP" | "MEMBER",
          targetId: String(form.get("targetId") ?? "").trim(),
        },
        status.plan,
      );
      return { ok: true, message: "Catalog assigned." };
    }
    if (intent === "unassign") {
      await removeAssignment(session.shop, catalogId, String(form.get("assignmentId") ?? ""));
      return { ok: true, message: "Assignment removed." };
    }
    if (intent === "import-csv") {
      const { rows, errors } = parseCatalogCsv(String(form.get("csv") ?? ""));
      if (rows.length === 0) return { ok: false, error: `No valid rows. ${errors.slice(0, 2).join(" ")}` };
      const n = await importCatalogCsv(session.shop, catalogId, rows, status.plan);
      return { ok: true, message: `Imported ${n} item(s).${errors.length ? ` ${errors.length} skipped.` : ""}` };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof ScopeNotAllowedError) return { ok: false, error: "That needs the Growth plan." };
    if (error instanceof NotFoundError) return { ok: false, error: "Catalog not found." };
    throw error;
  }
};

export default function CatalogBuilder() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [searchParams, setSearchParams] = useSearchParams();

  const [name, setName] = useState(data.detail.name);
  const [visibility, setVisibility] = useState<string>(data.detail.visibility);
  const [scope, setScope] = useState<string>(data.scopes[0]);
  const [targetId, setTargetId] = useState("");
  const [csv, setCsv] = useState("");
  const [previewSel, setPreviewSel] = useState(
    searchParams.get("company") ? `company:${searchParams.get("company")}` : searchParams.get("member") ? `member:${searchParams.get("member")}` : "",
  );

  const checkedKeys = new Set(
    data.detail.items.filter((i) => (visibility === "ALL" ? i.hidden : !i.hidden)).map((i) => `${i.productId}||${i.variantId ?? ""}`),
  );
  const modeLabel = visibility === "ALL" ? "Hidden" : "In catalog";

  const previewOptions = [
    { label: "Choose a customer…", value: "" },
    ...data.companies.map((c) => ({ label: `Company · ${c.name}`, value: `company:${c.id}` })),
    ...data.companies.flatMap((c) =>
      c.buyers.map((b) => ({ label: `Member · ${b.email}`, value: `member:${b.id}` })),
    ),
  ];

  const applyPreview = (value: string) => {
    setPreviewSel(value);
    const next = new URLSearchParams(searchParams);
    next.delete("company");
    next.delete("member");
    if (value.startsWith("company:")) next.set("company", value.slice(8));
    if (value.startsWith("member:")) next.set("member", value.slice(7));
    setSearchParams(next);
  };

  return (
    <Page backAction={{ url: "/app/catalogs" }} title={data.detail.name}>
      <TitleBar title={data.detail.name} />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}
        {data.catalogError && (
          <Banner tone="warning" title="We couldn’t load your products just now">
            <p>Refresh to try again — catalog membership is safe.</p>
          </Banner>
        )}

        {/* Name + visibility */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" blockAlign="end" wrap>
              <Form method="post">
                <input type="hidden" name="intent" value="rename" />
                <InlineStack gap="200" blockAlign="end">
                  <Box minWidth="240px"><TextField label="Name" name="name" value={name} onChange={setName} autoComplete="off" /></Box>
                  <Button submit loading={busy}>Rename</Button>
                </InlineStack>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="visibility" />
                <InlineStack gap="200" blockAlign="end">
                  <Select
                    label="Visibility"
                    name="visibility"
                    options={[
                      { label: "Assigned only (deny by default)", value: "ASSIGNED" },
                      { label: "Everything except hidden SKUs", value: "ALL" },
                    ]}
                    value={visibility}
                    onChange={setVisibility}
                  />
                  <Button submit loading={busy}>Save</Button>
                </InlineStack>
              </Form>
              {data.detail.isDefault && <Badge tone="info">Default catalog</Badge>}
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              {visibility === "ASSIGNED"
                ? "Only the products you check below are visible to assigned buyers. Everything else is hidden — including via direct URL, search, and the quote picker."
                : "Buyers see everything except the SKUs you check as hidden."}
            </Text>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="500">
          {/* Item grid */}
          <Card padding="0">
            <Box padding="400"><Text as="h2" variant="headingMd">Products ({modeLabel})</Text></Box>
            <Form method="post">
              <input type="hidden" name="intent" value="save-items" />
              <input type="hidden" name="mode" value={visibility} />
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <IndexTable
                  resourceName={{ singular: "product", plural: "products" }}
                  itemCount={data.products.length}
                  selectable={false}
                  headings={[{ title: modeLabel }, { title: "Product" }, { title: "SKU" }]}
                >
                  {data.products.map((p, i) => {
                    const key = `${p.productId}||${p.variantId}`;
                    return (
                      <IndexTable.Row id={p.variantId} key={p.variantId} position={i}>
                        <IndexTable.Cell>
                          <input type="checkbox" name="pick" value={key} defaultChecked={checkedKeys.has(key)} aria-label={`${modeLabel}: ${p.title}`} />
                        </IndexTable.Cell>
                        <IndexTable.Cell>{p.title}</IndexTable.Cell>
                        <IndexTable.Cell>{p.sku ?? "—"}</IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              </div>
              <Box padding="400"><Button variant="primary" submit loading={busy}>Save products</Button></Box>
            </Form>
          </Card>

          {/* Preview as customer */}
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Preview as customer</Text>
              <Select label="See what a customer sees" labelHidden options={previewOptions} value={previewSel} onChange={applyPreview} />
              {data.preview ? (
                <BlockStack gap="200">
                  <Badge tone="success">{`${data.preview.items.length} of ${data.preview.total} products visible`}</Badge>
                  <Divider />
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    <BlockStack gap="100">
                      {data.preview.items.length === 0 ? (
                        <Text as="p" tone="subdued" variant="bodySm">This customer sees no products under this assignment.</Text>
                      ) : (
                        data.preview.items.map((it) => (
                          <Text as="p" variant="bodySm" key={it.variantId}>{it.title}</Text>
                        ))
                      )}
                    </BlockStack>
                  </div>
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued" variant="bodySm">Pick a customer to preview exactly what they’d see in the portal and order pad.</Text>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Assignments */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Assignments</Text>
            <Form method="post">
              <input type="hidden" name="intent" value="assign" />
              <InlineStack gap="300" blockAlign="end" wrap>
                <Select
                  label="Assign to"
                  name="scope"
                  options={[
                    { label: "Company", value: "COMPANY" },
                    { label: "Group (customer tag)", value: "GROUP", disabled: !data.scopes.includes("GROUP") },
                    { label: "Member", value: "MEMBER", disabled: !data.scopes.includes("MEMBER") },
                  ]}
                  value={scope}
                  onChange={setScope}
                  helpText={data.isGrowth ? undefined : "Group & member assignment need Growth."}
                />
                <Box minWidth="280px">
                  {scope === "COMPANY" ? (
                    <Select label="Company" name="targetId" options={[{ label: "Choose…", value: "" }, ...data.companies.map((c) => ({ label: c.name, value: c.id }))]} value={targetId} onChange={setTargetId} />
                  ) : scope === "MEMBER" ? (
                    <Select label="Member" name="targetId" options={[{ label: "Choose…", value: "" }, ...data.companies.flatMap((c) => c.buyers.map((b) => ({ label: b.email, value: b.id })))]} value={targetId} onChange={setTargetId} />
                  ) : (
                    <TextField label="Customer tag" name="targetId" value={targetId} onChange={setTargetId} autoComplete="off" placeholder="e.g. vip" />
                  )}
                </Box>
                <Button submit variant="primary" loading={busy} disabled={!data.scopes.includes(scope as "COMPANY" | "GROUP" | "MEMBER")}>Assign</Button>
              </InlineStack>
            </Form>

            {data.detail.assignments.length > 0 && (
              <BlockStack gap="150">
                {data.detail.assignments.map((a) => (
                  <InlineStack key={a.id} align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm">
                      {a.companyId ? `Company · ${data.companies.find((c) => c.id === a.companyId)?.name ?? a.companyId}` : a.memberId ? `Member · ${a.memberId}` : `Group · ${a.customerGroupTag}`}
                    </Text>
                    <Form method="post">
                      <input type="hidden" name="intent" value="unassign" />
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <Button submit variant="tertiary" tone="critical" size="micro" loading={busy}>Remove</Button>
                    </Form>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* CSV import (Growth) */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">Bulk import (CSV)</Text>
              {!data.csvAllowed && <Badge tone="info">Growth</Badge>}
            </InlineStack>
            {data.csvAllowed ? (
              <Form method="post">
                <input type="hidden" name="intent" value="import-csv" />
                <BlockStack gap="200">
                  <TextField
                    label="Paste CSV (product_id,variant_id,hidden)"
                    name="csv"
                    value={csv}
                    onChange={setCsv}
                    multiline={4}
                    autoComplete="off"
                    placeholder={"gid://shopify/Product/1,,false\ngid://shopify/Product/2,gid://shopify/ProductVariant/9,true"}
                  />
                  <InlineStack><Button submit loading={busy}>Import CSV</Button></InlineStack>
                </BlockStack>
              </Form>
            ) : (
              <Text as="p" tone="subdued" variant="bodySm">CSV bulk import is a Growth feature.</Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
