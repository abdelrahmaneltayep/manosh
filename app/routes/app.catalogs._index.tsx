import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { getPlanLimits, catalogCapMessage, evaluateCatalogAllowance, GROWTH_PLAN } from "../lib/billing";
import {
  listCatalogs,
  createCatalog,
  deleteCatalog,
  CatalogCapError,
} from "../services/catalogs.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_CUSTOM_CATALOGS === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const catalogs = await listCatalogs(session.shop);
  const cap = getPlanLimits(status.plan).customCatalogCap;
  const usedCustom = catalogs.filter((c) => !c.isDefault).length;
  return {
    catalogs,
    isGrowth: status.plan === GROWTH_PLAN,
    cap: Number.isFinite(cap) ? cap : null,
    allowance: evaluateCatalogAllowance(usedCustom, cap),
    capMessage: catalogCapMessage(cap),
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Response | ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "create") {
      const id = await createCatalog(
        session.shop,
        {
          name: String(form.get("name") ?? ""),
          visibility: String(form.get("visibility") ?? "ASSIGNED") === "ALL" ? "ALL" : "ASSIGNED",
        },
        status.plan,
      );
      return redirect(`/app/catalogs/${id}`);
    }
    if (intent === "delete") {
      await deleteCatalog(session.shop, String(form.get("catalogId") ?? ""));
      return { ok: true, message: "Catalog deleted." };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof CatalogCapError) {
      return { ok: false, error: catalogCapMessage(getPlanLimits(status.plan).customCatalogCap) };
    }
    throw error;
  }
};

export default function CatalogsIndex() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("ASSIGNED");

  const atCap = !data.allowance.allowed;

  return (
    <Page>
      <TitleBar title="Custom catalogs" />
      <SectionTabs active="catalogs" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        <Text as="p" tone="subdued" variant="bodyMd">
          Show each buyer only the products they’re allowed to see. Assign a catalog
          to a company (or, on Growth, a group or a single member); everything else
          stays hidden — not greyed out, just not there.
        </Text>

        {atCap && !data.isGrowth && (
          <Banner tone="warning" title="You’ve reached your catalog limit">
            <p>{data.capMessage}</p>
            <Box paddingBlockStart="200">
              <Button url="/app/settings?upgrade=Growth" variant="primary">See Growth</Button>
            </Box>
          </Banner>
        )}

        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">New catalog</Text>
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="260px">
                  <TextField label="Name" name="name" value={name} onChange={setName} autoComplete="off" placeholder="e.g. Exclusive Line" />
                </Box>
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
                <Button variant="primary" submit loading={busy} disabled={atCap}>
                  Create catalog
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        <Card padding="0">
          {data.catalogs.length === 0 ? (
            <EmptyState
              heading="No catalogs yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Create your first catalog to control which buyers see which products.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "catalog", plural: "catalogs" }}
              itemCount={data.catalogs.length}
              selectable={false}
              headings={[
                { title: "Name" },
                { title: "Visibility" },
                { title: "Products" },
                { title: "Assignments" },
                { title: "" },
              ]}
            >
              {data.catalogs.map((c, i) => (
                <IndexTable.Row id={c.id} key={c.id} position={i}>
                  <IndexTable.Cell>
                    <Button variant="plain" url={`/app/catalogs/${c.id}`}>{c.name}</Button>
                    {c.isDefault && <Badge tone="info">Default</Badge>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={c.visibility === "ASSIGNED" ? "attention" : undefined}>
                      {c.visibility === "ASSIGNED" ? "Assigned only" : "All but hidden"}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{String(c.itemCount)}</IndexTable.Cell>
                  <IndexTable.Cell>{String(c.assignmentCount)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {!c.isDefault && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="catalogId" value={c.id} />
                        <Button submit tone="critical" variant="tertiary" size="micro" loading={busy}>
                          Delete
                        </Button>
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
