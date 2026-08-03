import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation, Link } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Select, IndexTable, EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { quoteFormFeatures, GROWTH_PLAN } from "../lib/billing";
import { SURFACES } from "../lib/quote-form";
import { QUOTE_CAPTURE_ENABLED, listForms, saveForm, deleteForm, MultipleFormsError } from "../services/quote-form.server";

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

  // Below Growth a shop keeps a single form — lock "Create" once one exists.
  const createLocked = !features.multipleForms && forms.length >= 1;

  return (
    <Page>
      <TitleBar title="Quote forms" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Your quote forms</Text>
            {forms.length === 0 ? (
              <EmptyState heading="Build your first quote form" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Add the fields buyers fill in when they request a quote. Attach it to a product, collection, cart, or standalone page.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "form", plural: "forms" }}
                itemCount={forms.length}
                selectable={false}
                headings={[{ title: "Name" }, { title: "Surface" }, { title: "Fields" }, { title: "Status" }, { title: "" }]}
              >
                {forms.map((f, i) => (
                  <IndexTable.Row id={f.id} key={f.id} position={i}>
                    <IndexTable.Cell><Link to={`/app/quote-forms/${f.id}`}>{f.name}</Link></IndexTable.Cell>
                    <IndexTable.Cell>{SURFACE_LABEL[f.surface] ?? f.surface}</IndexTable.Cell>
                    <IndexTable.Cell>{f.fields.length}</IndexTable.Cell>
                    <IndexTable.Cell><Badge tone={f.active ? "success" : undefined}>{f.active ? "Active" : "Draft"}</Badge></IndexTable.Cell>
                    <IndexTable.Cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={f.id} />
                        <Button submit variant="tertiary" tone="critical" size="micro" disabled={busy}>Delete</Button>
                      </Form>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">New form</Text>
            {createLocked ? (
              <Banner tone="info" title="Multiple forms are a Growth feature">
                <p>Your plan includes one quote form. Upgrade to Growth to run different forms on different surfaces.</p>
                <Box paddingBlockStart="200">
                  <Button url={`/app/settings?upgrade=${GROWTH_PLAN}`} variant="primary">See Growth</Button>
                </Box>
              </Banner>
            ) : (
              <Form method="post">
                <InlineStack gap="300" blockAlign="end" wrap>
                  <Box minWidth="16rem"><TextField label="Form name" name="name" value={name} onChange={setName} autoComplete="off" placeholder="Request a quote" /></Box>
                  <Box minWidth="14rem">
                    <Select label="Surface" name="surface" options={SURFACES.map((s) => ({ label: s.label, value: s.value }))} value={surface} onChange={setSurface} />
                  </Box>
                  <Button submit variant="primary" disabled={busy}>Create &amp; edit</Button>
                </InlineStack>
              </Form>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
