import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { GROWTH_PLAN } from "../lib/billing";
import {
  getPriceListDetail,
  saveEntry,
  deleteEntry,
  saveVolumeBreak,
  deleteVolumeBreak,
  assignCompany,
  unassignCompany,
  saveTagMapping,
  listCompaniesForAssignment,
  listTagMappings,
  parseEntriesCsv,
  importCsvRows,
  PriceListNotFoundError,
} from "../services/price-list.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_PRICELISTS === "true";
const MONEY = /^\d+(\.\d{1,4})?$/;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const detail = await getPriceListDetail(session.shop, params.id!);
  if (!detail) throw new Response("Price list not found", { status: 404 });

  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = status.plan === GROWTH_PLAN;
  const [companies, tags] = await Promise.all([
    listCompaniesForAssignment(session.shop),
    listTagMappings(session.shop, detail.list.id),
  ]);

  return {
    isGrowth,
    list: { id: detail.list.id, name: detail.list.name, currency: detail.list.currency },
    entries: detail.entries.map((e) => ({ id: e.id, variantId: e.variantId, price: e.price.toString() })),
    breaks: detail.breaks.map((b) => ({ id: b.id, variantId: b.variantId, minQty: b.minQty, price: b.price.toString() })),
    companies,
    tags,
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const listId = params.id!;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = status.plan === GROWTH_PLAN;
  const growthOnly = () =>
    ({ ok: false, error: "Volume breaks and CSV import are a Growth feature." } as const);

  try {
    if (intent === "add-entry") {
      const variantId = String(form.get("variantId") ?? "").trim();
      const price = String(form.get("price") ?? "").trim();
      if (!variantId) return { ok: false, error: "Enter a variant id (gid://shopify/ProductVariant/…)." };
      if (!MONEY.test(price)) return { ok: false, error: "Enter a valid price (e.g. 9.50)." };
      await saveEntry(session.shop, listId, variantId, price);
      return { ok: true, message: "Price saved." };
    }
    if (intent === "delete-entry") {
      await deleteEntry(session.shop, listId, String(form.get("entryId") ?? ""));
      return { ok: true, message: "Entry removed." };
    }
    if (intent === "add-break") {
      if (!isGrowth) return growthOnly();
      const variantId = String(form.get("variantId") ?? "").trim();
      const price = String(form.get("price") ?? "").trim();
      const minQty = Number(form.get("minQty"));
      if (!variantId) return { ok: false, error: "Enter a variant id." };
      if (!Number.isInteger(minQty) || minQty < 1) return { ok: false, error: "Min qty must be a whole number ≥ 1." };
      if (!MONEY.test(price)) return { ok: false, error: "Enter a valid price." };
      await saveVolumeBreak(session.shop, listId, variantId, minQty, price);
      return { ok: true, message: "Volume break saved." };
    }
    if (intent === "delete-break") {
      if (!isGrowth) return growthOnly();
      await deleteVolumeBreak(session.shop, listId, String(form.get("breakId") ?? ""));
      return { ok: true, message: "Break removed." };
    }
    if (intent === "assign-company") {
      const companyId = String(form.get("companyId") ?? "");
      if (!companyId) return { ok: false, error: "Choose a company." };
      await assignCompany(session.shop, companyId, listId);
      return { ok: true, message: "List assigned to company." };
    }
    if (intent === "unassign-company") {
      await unassignCompany(session.shop, String(form.get("companyId") ?? ""));
      return { ok: true, message: "Company unassigned." };
    }
    if (intent === "save-tag") {
      if (!isGrowth) return growthOnly();
      await saveTagMapping(session.shop, String(form.get("tag") ?? ""), listId);
      return { ok: true, message: "Tag mapping saved." };
    }
    if (intent === "import-csv") {
      if (!isGrowth) return growthOnly();
      const { rows, errors } = parseEntriesCsv(String(form.get("csv") ?? ""));
      if (rows.length === 0) {
        return { ok: false, error: `No valid rows. ${errors.slice(0, 3).join(" ")}` };
      }
      const applied = await importCsvRows(session.shop, listId, rows);
      const tail = errors.length ? ` ${errors.length} row(s) skipped.` : "";
      return { ok: true, message: `Imported ${applied} row(s).${tail}` };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof PriceListNotFoundError) return { ok: false, error: "Price list not found." };
    throw error;
  }
};

export default function PriceListEditor() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [variantId, setVariantId] = useState("");
  const [price, setPrice] = useState("");
  const [bVariant, setBVariant] = useState("");
  const [bMinQty, setBMinQty] = useState("");
  const [bPrice, setBPrice] = useState("");
  const [assignCo, setAssignCo] = useState(data.companies[0]?.id ?? "");
  const [tag, setTag] = useState("");
  const [csv, setCsv] = useState("");

  const err = actionData && !actionData.ok ? actionData.error : null;
  const msg = actionData && actionData.ok ? actionData.message : null;
  const assigned = data.companies.filter((c) => c.assignedListId === data.list.id);

  return (
    <Page
      backAction={{ content: "Price lists", url: "/app/price-lists" }}
      title={data.list.name}
      subtitle={`Currency ${data.list.currency}`}
    >
      <TitleBar title="Price list" />
      <BlockStack gap="500">
        {err && (
          <Banner tone="critical" title="Couldn’t save">
            <p>{err}</p>
          </Banner>
        )}
        {msg && <Banner tone="success" title={msg} />}

        {/* Entries */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Prices
            </Text>
            <Form method="post">
              <input type="hidden" name="intent" value="add-entry" />
              <InlineGrid columns={{ xs: 1, sm: "2fr 1fr auto" }} gap="200">
                <TextField
                  label="Variant id"
                  name="variantId"
                  value={variantId}
                  onChange={setVariantId}
                  autoComplete="off"
                  placeholder="gid://shopify/ProductVariant/123"
                />
                <TextField
                  label="Price"
                  name="price"
                  value={price}
                  onChange={setPrice}
                  autoComplete="off"
                  prefix="$"
                />
                <Box paddingBlockStart="600">
                  <Button submit loading={submitting}>
                    Add / update
                  </Button>
                </Box>
              </InlineGrid>
            </Form>

            {data.entries.length === 0 ? (
              <Text as="p" tone="subdued">
                No prices yet. Add one above, or import a CSV (Growth).
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "entry", plural: "entries" }}
                itemCount={data.entries.length}
                selectable={false}
                headings={[{ title: "Variant" }, { title: "Price" }, { title: "" }]}
              >
                {data.entries.map((e, i) => (
                  <IndexTable.Row id={e.id} key={e.id} position={i}>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" breakWord>
                        {e.variantId}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {data.list.currency} {Number(e.price).toFixed(2)}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete-entry" />
                        <input type="hidden" name="entryId" value={e.id} />
                        <Button size="slim" tone="critical" variant="plain" submit>
                          Delete
                        </Button>
                      </Form>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        {/* Volume breaks (Growth) */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Volume breaks
              </Text>
              <Badge tone="info">Growth</Badge>
            </InlineStack>
            {!data.isGrowth ? (
              <Banner tone="warning">
                <p>Upgrade to Growth to add quantity-break pricing.</p>
                <Box paddingBlockStart="200">
                  <Button url="/app/settings" variant="primary">
                    Upgrade to Growth
                  </Button>
                </Box>
              </Banner>
            ) : (
              <>
                <Form method="post">
                  <input type="hidden" name="intent" value="add-break" />
                  <InlineGrid columns={{ xs: 1, sm: "2fr 1fr 1fr auto" }} gap="200">
                    <TextField label="Variant id" name="variantId" value={bVariant} onChange={setBVariant} autoComplete="off" placeholder="gid://…/ProductVariant/123" />
                    <TextField label="Min qty" name="minQty" type="number" min={1} value={bMinQty} onChange={setBMinQty} autoComplete="off" />
                    <TextField label="Price" name="price" value={bPrice} onChange={setBPrice} autoComplete="off" prefix="$" />
                    <Box paddingBlockStart="600">
                      <Button submit loading={submitting}>
                        Add break
                      </Button>
                    </Box>
                  </InlineGrid>
                </Form>
                {data.breaks.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No volume breaks yet.
                  </Text>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "break", plural: "breaks" }}
                    itemCount={data.breaks.length}
                    selectable={false}
                    headings={[{ title: "Variant" }, { title: "Min qty" }, { title: "Price" }, { title: "" }]}
                  >
                    {data.breaks.map((b, i) => (
                      <IndexTable.Row id={b.id} key={b.id} position={i}>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm" breakWord>
                            {b.variantId}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{b.minQty}+</IndexTable.Cell>
                        <IndexTable.Cell>
                          {data.list.currency} {Number(b.price).toFixed(2)}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete-break" />
                            <input type="hidden" name="breakId" value={b.id} />
                            <Button size="slim" tone="critical" variant="plain" submit>
                              Delete
                            </Button>
                          </Form>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </>
            )}
          </BlockStack>
        </Card>

        {/* CSV */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">
                CSV
              </Text>
              <Badge tone="info">Import: Growth</Badge>
            </InlineStack>
            <InlineStack gap="200">
              <Button url={`/app/price-lists/${data.list.id}/csv`} download>
                Export entries
              </Button>
              <Button url={`/app/price-lists/${data.list.id}/csv?template=1`} download variant="plain">
                Download template
              </Button>
            </InlineStack>
            {data.isGrowth ? (
              <Form method="post">
                <input type="hidden" name="intent" value="import-csv" />
                <BlockStack gap="200">
                  <TextField
                    label="Paste CSV (variant_id,price,min_qty)"
                    name="csv"
                    value={csv}
                    onChange={setCsv}
                    autoComplete="off"
                    multiline={4}
                    helpText="A row with min_qty sets a volume break; without it, a fixed entry."
                  />
                  <InlineStack>
                    <Button submit loading={submitting}>
                      Import CSV
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            ) : (
              <Text as="p" tone="subdued">
                CSV import is a Growth feature. Export and the template are available
                on any plan.
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* Assignment */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Assign to companies
            </Text>
            {data.companies.length === 0 ? (
              <Text as="p" tone="subdued">
                No companies yet.
              </Text>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="assign-company" />
                <InlineGrid columns={{ xs: 1, sm: "1fr auto" }} gap="200">
                  <Select
                    label="Company"
                    name="companyId"
                    options={data.companies.map((c) => ({ label: c.name, value: c.id }))}
                    value={assignCo}
                    onChange={setAssignCo}
                  />
                  <Box paddingBlockStart="600">
                    <Button submit loading={submitting}>
                      Assign
                    </Button>
                  </Box>
                </InlineGrid>
              </Form>
            )}
            {assigned.length > 0 && (
              <BlockStack gap="0">
                {assigned.map((c) => (
                  <InlineStack key={c.id} align="space-between" blockAlign="center">
                    <Text as="span">{c.name}</Text>
                    <Form method="post">
                      <input type="hidden" name="intent" value="unassign-company" />
                      <input type="hidden" name="companyId" value={c.id} />
                      <Button size="slim" variant="plain" tone="critical" submit>
                        Remove
                      </Button>
                    </Form>
                  </InlineStack>
                ))}
              </BlockStack>
            )}

            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingSm">
                Auto-apply by customer tag
              </Text>
              <Badge tone="info">Growth</Badge>
            </InlineStack>
            {data.isGrowth ? (
              <Form method="post">
                <input type="hidden" name="intent" value="save-tag" />
                <InlineGrid columns={{ xs: 1, sm: "1fr auto" }} gap="200">
                  <TextField
                    label="Shopify customer tag"
                    name="tag"
                    value={tag}
                    onChange={setTag}
                    autoComplete="off"
                    placeholder="e.g. wholesale-a"
                  />
                  <Box paddingBlockStart="600">
                    <Button submit loading={submitting}>
                      Map tag
                    </Button>
                  </Box>
                </InlineGrid>
              </Form>
            ) : (
              <Text as="p" tone="subdued">
                Tag-based auto-apply is a Growth feature.
              </Text>
            )}
            {data.tags.length > 0 && (
              <Text as="p" tone="subdued" variant="bodySm">
                Applied to tags: {data.tags.join(", ")}
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
