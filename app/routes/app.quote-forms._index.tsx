import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useState } from "react";
import { useActionData, useLoaderData, useNavigation, useSubmit, Link } from "@remix-run/react";
import {
  Page, Card, BlockStack, Text, Badge, Banner, Button, Box, TextField, Select, IndexTable, EmptyState, Modal, FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { quoteFormFeatures, GROWTH_PLAN } from "../lib/billing";
import { SURFACES } from "../lib/quote-form";
import { QUOTE_CAPTURE_ENABLED, listForms, saveForm, deleteForm, MultipleFormsError } from "../services/quote-form.server";
import { upgradeUrl } from "../lib/upgrade";
import { ConfirmAction } from "../components/ConfirmAction";

const IS_TEST = process.env.NODE_ENV !== "production";

const SURFACE_LABEL: Record<string, string> = Object.fromEntries(SURFACES.map((s) => [s.value, s.label]));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const forms = await listForms(session.shop);
  return { forms, features: quoteFormFeatures(status.plan) };
};

type ActionResult = { ok: boolean; message?: string; error?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const { session } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "delete") {
    await deleteForm(session.shop, String(form.get("id") ?? ""));
    return { ok: true, message: "Form deleted." };
  }

  // Create a new (empty) form, then jump into its builder.
  try {
    const res = await saveForm(session.shop, {
      name: String(form.get("name") ?? "").trim() || "Quote form",
      surface: (String(form.get("surface") ?? "PRODUCT") as "PRODUCT" | "COLLECTION" | "CART" | "PAGE"),
      fields: [],
    });
    if ("error" in res) return { ok: false, error: res.error };
    return redirect(`/app/quote-forms/${res.id}`);
  } catch (error) {
    if (error instanceof MultipleFormsError) return { ok: false, error: "Multiple forms need the Growth plan." };
    throw error;
  }
};

export default function QuoteForms() {
  const { forms, features } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [name, setName] = useState("");
  const [surface, setSurface] = useState("PRODUCT");

  // Below Growth a shop keeps a single form — "Create form" shows as disabled
  // and names the plan that unlocks it (BFS 4.3.7), instead of a dead end.
  const createLocked = !features.multipleForms && forms.length >= 1;
  const [createOpen, setCreateOpen] = useState(false);
  const submit = useSubmit();
  const create = () => {
    const fd = new FormData();
    fd.set("intent", "create");
    fd.set("name", name);
    fd.set("surface", surface);
    submit(fd, { method: "post" });
  };

  return (
    <Page
      primaryAction={{
        content: "Create form",
        onAction: () => setCreateOpen(true),
        disabled: createLocked,
        helpText: createLocked ? "Multiple forms are on Growth" : undefined,
      }}
    >
      <TitleBar title="Quote forms" />
      <SectionTabs active="quote-forms" />
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a quote form"
        primaryAction={{ content: "Create and edit", onAction: create, loading: busy }}
        secondaryActions={[{ content: "Cancel", onAction: () => setCreateOpen(false) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField label="Form name" value={name} onChange={setName} autoComplete="off" placeholder="Request a quote" />
            <Select
              label="Where it shows"
              options={SURFACES.map((x) => ({ label: x.label, value: x.value }))}
              value={surface}
              onChange={setSurface}
              helpText="You can add fields and change this in the next step."
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}
        {createLocked && (
          <Banner tone="info" title="Multiple forms are on the Growth plan" action={{ content: "See plans", url: upgradeUrl(GROWTH_PLAN) }}>
            <p>Your plan includes one quote form. Growth lets you run different forms on different pages.</p>
          </Banner>
        )}

        <Card padding="0">
          {forms.length === 0 ? (
            <EmptyState
              heading="Create your first quote form"
              action={{ content: "Create form", onAction: () => setCreateOpen(true) }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Choose the fields buyers fill in when they ask for a quote, and where the form shows: a product, collection, cart or its own page.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "form", plural: "forms" }}
              itemCount={forms.length}
              selectable={false}
              headings={[{ title: "Name" }, { title: "Where it shows" }, { title: "Fields" }, { title: "Status" }, { title: "Actions" }]}
            >
              {forms.map((f, i) => (
                <IndexTable.Row id={f.id} key={f.id} position={i}>
                  <IndexTable.Cell><Link to={`/app/quote-forms/${f.id}`}>{f.name}</Link></IndexTable.Cell>
                  <IndexTable.Cell>{SURFACE_LABEL[f.surface] ?? f.surface}</IndexTable.Cell>
                  <IndexTable.Cell>{f.fields.length}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={f.active ? "success" : undefined}>{f.active ? "Active" : "Draft"}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>
                    <ConfirmAction
                      label="Delete"
                      size="micro"
                      variant="tertiary"
                      title={`Delete “${f.name}”?`}
                      message="The form comes off your storefront and its fields are deleted. Requests already received stay in your inbox."
                      confirmLabel="Delete form"
                      fields={{ intent: "delete", id: f.id }}
                    />
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
        <Box paddingBlockStart="100">
          <Text as="p" tone="subdued" variant="bodySm">
            A form shows on your storefront once it’s active and the Request a Quote block is in your theme (Quotes → Requests → Storefront button).
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
