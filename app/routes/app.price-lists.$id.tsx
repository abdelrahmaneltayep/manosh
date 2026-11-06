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
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { DisclosureCard } from "../components/DisclosureCard";
import { ConfirmAction } from "../components/ConfirmAction";
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
import { upgradeUrl } from "../lib/upgrade";

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
  const cur = data.list.currency;

  return (
    <Page
      backAction={{ content: "Price lists", url: "/app/price-lists" }}
      title={data.list.name}
      subtitle={`Currency ${cur}`}
    >
      <TitleBar title={data.list.name} />
      <BlockStack gap="500">
        {err && (
          <Banner tone="critical" title="Couldn’t save">
            <p>{err}</p>
          </Banner>
        )}
        {msg && <Banner tone="success" title={msg} />}

        {/* 1. Prices: the list first, then the add form */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Prices
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Buyers of assigned companies pay these prices instead of your regular price.
              </Text>
            </BlockStack>
          </Box>
          {data.entries.length === 0 ? (
            <Box paddingInline="400" paddingBlockEnd="400">
              <Text as="p" tone="subdued">
                No prices yet, so assigned buyers still see your regular prices. Add a price below
                {data.isGrowth ? " or import a CSV file." : "."}
              </Text>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "price", plural: "prices" }}
              itemCount={data.entries.length}
              selectable={false}
              headings={[{ title: "Variant" }, { title: "Price" }, { title: "Actions", hidden: true }]}
            >
              {data.entries.map((e, i) => (
                <IndexTable.Row id={e.id} key={e.id} position={i}>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" breakWord>
                      {e.variantId}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {cur} {Number(e.price).toFixed(2)}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <ConfirmAction
                      label="Delete"
                      title="Delete this price?"
                      message="Buyers on this list will pay your regular price for this variant again."
                      confirmLabel="Delete price"
                      fields={{ intent: "delete-entry", entryId: e.id }}
                      size="micro"
                      variant="tertiary"
                    />
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
          <Divider />
          <Box padding="400">
            <Form method="post">
              <input type="hidden" name="intent" value="add-entry" />
              <InlineGrid columns={{ xs: 1, sm: "2fr 1fr auto" }} gap="200">
                <TextField
                  label="Variant ID"
                  name="variantId"
                  value={variantId}
                  onChange={setVariantId}
                  autoComplete="off"
                  placeholder="gid://shopify/ProductVariant/123"
                  helpText="Saving a variant that’s already on the list updates its price."
                />
                <TextField label="Price" name="price" value={price} onChange={setPrice} autoComplete="off" prefix={cur} />
                <Box paddingBlockStart="600">
                  <Button submit loading={submitting}>
                    Save price
                  </Button>
                </Box>
              </InlineGrid>
            </Form>
          </Box>
        </Card>

        {/* 2. Who gets this list */}
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Companies
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                A company can have one price list. Assigning this list replaces any list it had before.
              </Text>
            </BlockStack>
            {assigned.length === 0 ? (
              <Text as="p" tone="subdued">
                Not assigned yet, so no buyer sees these prices. Assign a company below.
              </Text>
            ) : (
              <BlockStack gap="200">
                {assigned.map((c) => (
                  <InlineStack key={c.id} align="space-between" blockAlign="center">
                    <Text as="span">{c.name}</Text>
                    <ConfirmAction
                      label="Remove"
                      title={`Remove ${c.name}?`}
                      message={`${c.name}’s buyers will see your regular prices again.`}
                      confirmLabel="Remove company"
                      fields={{ intent: "unassign-company", companyId: c.id }}
                      size="micro"
                      variant="tertiary"
                    />
                  </InlineStack>
                ))}
              </BlockStack>
            )}
            {data.companies.length === 0 ? (
              <Text as="p" tone="subdued">
                You don’t have any companies yet. Companies appear here once you add B2B buyers.
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
                      Assign company
                    </Button>
                  </Box>
                </InlineGrid>
              </Form>
            )}
          </BlockStack>
        </Card>

        {/* 3. Advanced options, one click away */}
        <DisclosureCard
          title="Volume breaks"
          subtitle="Charge a lower price when a buyer orders at least a set quantity."
          badge={<Badge tone="info">Growth</Badge>}
          defaultOpen={data.breaks.length > 0}
        >
          {!data.isGrowth ? (
            <Banner tone="info" action={{ content: "Upgrade to Growth", url: upgradeUrl("growth") }}>
              <p>Volume breaks come with the Growth plan.</p>
            </Banner>
          ) : (
            <BlockStack gap="300">
              {data.breaks.length === 0 ? (
                <Text as="p" tone="subdued">
                  No volume breaks yet, so every quantity pays the same price. Add one below.
                </Text>
              ) : (
                <IndexTable
                  resourceName={{ singular: "volume break", plural: "volume breaks" }}
                  itemCount={data.breaks.length}
                  selectable={false}
                  headings={[{ title: "Variant" }, { title: "Min quantity" }, { title: "Price" }, { title: "Actions", hidden: true }]}
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
                        {cur} {Number(b.price).toFixed(2)}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <ConfirmAction
                          label="Delete"
                          title="Delete this volume break?"
                          message={`Orders of ${b.minQty} or more will no longer get this price.`}
                          confirmLabel="Delete break"
                          fields={{ intent: "delete-break", breakId: b.id }}
                          size="micro"
                          variant="tertiary"
                        />
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
              <Form method="post">
                <input type="hidden" name="intent" value="add-break" />
                <InlineGrid columns={{ xs: 1, sm: "2fr 1fr 1fr auto" }} gap="200">
                  <TextField label="Variant ID" name="variantId" value={bVariant} onChange={setBVariant} autoComplete="off" placeholder="gid://shopify/ProductVariant/123" />
                  <TextField label="Min quantity" name="minQty" type="number" min={1} value={bMinQty} onChange={setBMinQty} autoComplete="off" />
                  <TextField label="Price" name="price" value={bPrice} onChange={setBPrice} autoComplete="off" prefix={cur} />
                  <Box paddingBlockStart="600">
                    <Button submit loading={submitting}>
                      Add break
                    </Button>
                  </Box>
                </InlineGrid>
              </Form>
            </BlockStack>
          )}
        </DisclosureCard>

        <DisclosureCard
          title="Import and export"
          subtitle="Download prices as a CSV file, or update many prices at once."
          badge={<Badge tone="info">Import: Growth</Badge>}
        >
          <BlockStack gap="300">
            <InlineStack gap="200">
              <Button url={`/app/price-lists/${data.list.id}/csv`} download>
                Export prices
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
                    helpText="A row with min_qty sets a volume break; without it, a fixed price."
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
                Importing comes with the Growth plan. Export and the template work on any plan.
              </Text>
            )}
          </BlockStack>
        </DisclosureCard>

        <DisclosureCard
          title="Apply by customer tag"
          subtitle="Give this list to every buyer with a Shopify customer tag."
          badge={<Badge tone="info">Growth</Badge>}
          defaultOpen={data.tags.length > 0}
        >
          <BlockStack gap="300">
            {data.tags.length > 0 && (
              <Text as="p" variant="bodySm">
                Applied to tags: {data.tags.join(", ")}
              </Text>
            )}
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
                      Save tag
                    </Button>
                  </Box>
                </InlineGrid>
              </Form>
            ) : (
              <Banner tone="info" action={{ content: "Upgrade to Growth", url: upgradeUrl("growth") }}>
                <p>Applying a list by customer tag comes with the Growth plan.</p>
              </Banner>
            )}
          </BlockStack>
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
