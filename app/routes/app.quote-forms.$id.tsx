import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Select, Checkbox, Divider, Tooltip,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { quoteFormFeatures } from "../lib/billing";
import { FIELD_TYPES, SURFACES, emptyField, moveField, type QuoteFormField, type QuoteFieldType } from "../lib/quote-form";
import { QUOTE_CAPTURE_ENABLED, getForm, saveForm } from "../services/quote-form.server";

const IS_TEST = process.env.NODE_ENV !== "production";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const form = await getForm(session.shop, params.id!);
  if (!form) throw new Response("Form not found", { status: 404 });
  return { form, features: quoteFormFeatures(status.plan) };
};

type ActionResult = { ok: boolean; message?: string; error?: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  let fields: unknown = [];
  try {
    fields = JSON.parse(String(form.get("fields") ?? "[]"));
  } catch {
    return { ok: false, error: "Couldn’t read the fields — please try again." };
  }
  const res = await saveForm(session.shop, {
    id: params.id!,
    name: String(form.get("name") ?? ""),
    surface: (String(form.get("surface") ?? "PRODUCT") as "PRODUCT" | "COLLECTION" | "CART" | "PAGE"),
    fields,
    active: form.get("active") === "on",
    successMessage: String(form.get("successMessage") ?? ""),
  });
  return "error" in res ? { ok: false, error: res.error } : { ok: true, message: "Form saved." };
};

export default function QuoteFormBuilder() {
  const { form, features } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [name, setName] = useState(form.name);
  const [surface, setSurface] = useState(form.surface);
  const [active, setActive] = useState(form.active);
  const [fields, setFields] = useState<QuoteFormField[]>(form.fields);
  const [newType, setNewType] = useState<QuoteFieldType>("text");
  const [successMessage, setSuccessMessage] = useState(form.successMessage ?? "");
  const advanced = features.conditionalLogic; // Growth

  const update = (i: number, patch: Partial<QuoteFormField>) =>
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const setShowIf = (i: number, ref: string, equals: string) =>
    setFields(fields.map((f, idx) => (idx === i ? { ...f, showIf: ref ? { field: ref, equals } : undefined } : f)));
  const addField = () => setFields([...fields, emptyField(newType)]);
  const removeField = (i: number) => setFields(fields.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => setFields(moveField(fields, i, i + dir));

  return (
    <Page backAction={{ url: "/app/quote-forms" }}>
      <TitleBar title={`Edit — ${form.name}`} />
      <Form method="post">
        <input type="hidden" name="fields" value={JSON.stringify(fields)} />
        <input type="hidden" name="active" value={active ? "on" : "off"} />
        <input type="hidden" name="successMessage" value={successMessage} />
        <BlockStack gap="400">
          {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
          {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="16rem"><TextField label="Form name" name="name" value={name} onChange={setName} autoComplete="off" /></Box>
                <Box minWidth="14rem">
                  <Select label="Surface" name="surface" options={SURFACES.map((s) => ({ label: s.label, value: s.value }))} value={surface} onChange={(v) => setSurface(v as typeof surface)} />
                </Box>
                <Checkbox label="Active (render on the storefront)" checked={active} onChange={setActive} />
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Fields</Text>
              {fields.length === 0 && (
                <Text as="p" tone="subdued" variant="bodyMd">No fields yet. Add the first one below.</Text>
              )}
              {fields.map((f, i) => (
                <Box key={i} padding="300" borderColor="border" borderWidth="025" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack gap="300" blockAlign="end" wrap>
                      <Box minWidth="14rem"><TextField label="Label" value={f.label} onChange={(v) => update(i, { label: v })} autoComplete="off" /></Box>
                      <Box minWidth="10rem">
                        <Select label="Type" options={FIELD_TYPES.map((t) => ({ label: t.label, value: t.value }))} value={f.type} onChange={(v) => update(i, { type: v as QuoteFieldType })} />
                      </Box>
                      <Checkbox label="Required" checked={f.required} onChange={(v) => update(i, { required: v })} />
                    </InlineStack>
                    <InlineStack gap="300" blockAlign="end" wrap>
                      <Box minWidth="14rem"><TextField label="Placeholder" value={f.placeholder ?? ""} onChange={(v) => update(i, { placeholder: v })} autoComplete="off" /></Box>
                      <Box minWidth="14rem"><TextField label="Help text" value={f.help ?? ""} onChange={(v) => update(i, { help: v })} autoComplete="off" /></Box>
                      {f.type === "dropdown" && (
                        <Box minWidth="16rem"><TextField label="Options (comma-separated)" value={(f.options ?? []).join(", ")} onChange={(v) => update(i, { options: v.split(",").map((o) => o.trim()).filter(Boolean) })} autoComplete="off" /></Box>
                      )}
                    </InlineStack>
                    {advanced && i > 0 && (
                      <InlineStack gap="300" blockAlign="end" wrap>
                        <Box minWidth="14rem">
                          <Select
                            label="Show only if"
                            options={[{ label: "Always show", value: "" }, ...fields.slice(0, i).map((pf) => ({ label: pf.label, value: pf.key }))]}
                            value={f.showIf?.field ?? ""}
                            onChange={(v) => setShowIf(i, v, f.showIf?.equals ?? "")}
                          />
                        </Box>
                        {f.showIf?.field && (
                          <Box minWidth="12rem"><TextField label="equals" value={f.showIf.equals} onChange={(v) => setShowIf(i, f.showIf!.field, v)} autoComplete="off" /></Box>
                        )}
                      </InlineStack>
                    )}
                    <InlineStack gap="200">
                      <Button size="micro" disabled={i === 0} onClick={() => move(i, -1)} accessibilityLabel="Move up">↑</Button>
                      <Button size="micro" disabled={i === fields.length - 1} onClick={() => move(i, 1)} accessibilityLabel="Move down">↓</Button>
                      <Button size="micro" tone="critical" variant="tertiary" onClick={() => removeField(i)}>Remove</Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              ))}
              <Divider />
              <InlineStack gap="300" blockAlign="end">
                <Box minWidth="12rem">
                  <Select label="Add a field" options={FIELD_TYPES.map((t) => ({ label: t.label, value: t.value }))} value={newType} onChange={(v) => setNewType(v as QuoteFieldType)} />
                </Box>
                <Button onClick={addField}>Add field</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">After submit</Text>
                {!advanced && <Badge tone="info">Growth</Badge>}
              </InlineStack>
              {advanced ? (
                <TextField
                  label="Thank-you message"
                  value={successMessage}
                  onChange={setSuccessMessage}
                  autoComplete="off"
                  multiline={2}
                  placeholder="Thanks — we got your request and will reply with pricing."
                  helpText="Shown to the buyer after they submit this form."
                />
              ) : (
                <Tooltip content="Upgrade to Growth for conditional fields and a custom thank-you message.">
                  <Box>
                    <TextField label="Thank-you message" value="" disabled autoComplete="off" helpText="Conditional fields + a custom thank-you message are on Growth." />
                  </Box>
                </Tooltip>
              )}
            </BlockStack>
          </Card>

          <InlineStack>
            <Button submit variant="primary" disabled={busy} loading={busy}>Save form</Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Page>
  );
}

export const ErrorBoundary = () => (
  <Page><Banner tone="critical" title="Something went wrong">Couldn’t load this form. Go back and try again.</Banner></Page>
);
