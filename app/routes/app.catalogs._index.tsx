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
import { DisclosureCard } from "../components/DisclosureCard";
import { ConfirmAction } from "../components/ConfirmAction";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { getPlanLimits, catalogCapMessage, evaluateCatalogAllowance, GROWTH_PLAN } from "../lib/billing";
import {
  listCatalogs,
  createCatalog,
  deleteCatalog,
  CatalogCapError,
} from "../services/catalogs.server";
import { upgradeUrl } from "../lib/upgrade";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_CUSTOM_CATALOGS === "true";
const NAME_FIELD_ID = "catalog-name";

/** Move focus to the create form's first field (EmptyState action). */
function focusField(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.focus();
}

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
  const firstRun = data.catalogs.every((c) => c.isDefault);

  return (
    <Page>
      <TitleBar title="Catalogs" />
      <SectionTabs active="catalogs" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        {/* 1. The list the merchant works in */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Your catalogs</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Show each buyer only the products they’re allowed to see.
              </Text>
            </BlockStack>
          </Box>
          {data.catalogs.length === 0 ? (
            <EmptyState
              heading="No catalogs yet"
              action={atCap ? { content: "See Growth", url: upgradeUrl("growth") } : { content: "Create catalog", onAction: () => focusField(NAME_FIELD_ID) }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Every buyer sees all of your products until you create a catalog and assign it.</p>
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
                { title: "Actions", hidden: true },
              ]}
            >
              {data.catalogs.map((c, i) => (
                <IndexTable.Row id={c.id} key={c.id} position={i}>
                  <IndexTable.Cell>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Button variant="plain" url={`/app/catalogs/${c.id}`}>{c.name}</Button>
                      {c.isDefault && <Badge tone="info">Default</Badge>}
                    </InlineStack>
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
                      <ConfirmAction
                        label="Delete"
                        title={`Delete ${c.name}?`}
                        message="Its assignments are removed too, so those buyers fall back to their next matching catalog or your default. This can’t be undone."
                        confirmLabel="Delete catalog"
                        fields={{ intent: "delete", catalogId: c.id }}
                        size="micro"
                        variant="tertiary"
                        disabled={busy}
                      />
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* 2. Create */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Create a catalog</Text>
              {atCap && !data.isGrowth && (
                <Banner
                  tone="warning"
                  title="You’ve reached your catalog limit"
                  action={{ content: "See Growth", url: upgradeUrl("growth") }}
                >
                  <p>{data.capMessage}</p>
                </Banner>
              )}
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="260px">
                  <TextField id={NAME_FIELD_ID} label="Name" name="name" value={name} onChange={setName} autoComplete="off" placeholder="e.g. Exclusive line" />
                </Box>
                <Select
                  label="Visibility"
                  name="visibility"
                  options={[
                    { label: "Only the products I pick", value: "ASSIGNED" },
                    { label: "Everything except products I hide", value: "ALL" },
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

        {/* 3. Explanation, one click away (open on first run) */}
        <DisclosureCard
          title="How catalogs work"
          subtitle="Assign a catalog to a company, a customer group, or a single buyer."
          defaultOpen={firstRun}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              Assign a catalog to a company (or, on Growth, a customer group or a single buyer).
              Products outside it are hidden from those buyers, not greyed out, just not there:
              in the portal, in search, through a direct link, and in the quote picker.
            </Text>
            <Text as="p" variant="bodyMd">
              “Only the products I pick” hides everything you don’t add. “Everything except
              products I hide” shows your whole store minus the products you hide.
            </Text>
          </BlockStack>
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
