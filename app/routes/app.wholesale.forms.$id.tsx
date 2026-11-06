import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
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
  Checkbox,
  IndexTable,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { ConfirmAction } from "../components/ConfirmAction";
import { DisclosureCard } from "../components/DisclosureCard";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { GROWTH_PLAN } from "../lib/billing";
import { slugifyKey, type WholesaleFieldType } from "../lib/wholesale";
import { getForm, saveField, deleteField, updateFormSettings, NotFoundError } from "../services/wholesale.server";
import { upgradeUrl } from "../lib/upgrade";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_WHOLESALE_REG === "true";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const form = await getForm(session.shop, params.id!);
  if (!form) throw new Response("Form not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  return {
    isGrowth: status.plan === GROWTH_PLAN,
    publicUrl: `${appUrl}/apply/${session.shop}`,
    form: {
      id: form.id,
      name: form.name,
      published: form.published,
      autoApproveDomains: form.autoApproveDomains,
      fields: form.fields.map((f) => ({
        id: f.id,
        label: f.label,
        key: f.key,
        type: f.type,
        required: f.required,
      })),
    },
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = status.plan === GROWTH_PLAN;
  const formId = params.id!;
  const body = await request.formData();
  const intent = String(body.get("intent") ?? "");

  try {
    if (intent === "add-field") {
      const label = String(body.get("label") ?? "").trim();
      if (!label) return { ok: false, error: "Give the field a label." };
      const type = String(body.get("type") ?? "TEXT") as WholesaleFieldType;
      if (type === "FILE" && !isGrowth) return { ok: false, error: "File upload fields are a Growth feature." };
      const required = body.get("required") === "on";
      const options = String(body.get("options") ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await saveField(session.shop, formId, {
        label,
        key: slugifyKey(label),
        type,
        required,
        options: type === "SELECT" ? options : undefined,
      });
      return { ok: true, message: "Field added." };
    }
    if (intent === "delete-field") {
      await deleteField(session.shop, formId, String(body.get("fieldId") ?? ""));
      return { ok: true, message: "Field removed." };
    }
    if (intent === "publish") {
      await updateFormSettings(session.shop, formId, { published: body.get("published") === "on" });
      return { ok: true, message: "Form updated." };
    }
    if (intent === "auto-approve") {
      if (!isGrowth) return { ok: false, error: "Auto-approval rules are a Growth feature." };
      const domains = String(body.get("domains") ?? "")
        .split(/[\n,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      await updateFormSettings(session.shop, formId, { autoApproveDomains: domains });
      return { ok: true, message: "Auto-approval domains saved." };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "Form not found." };
    throw error;
  }
};

const TYPE_OPTIONS = [
  { label: "Text", value: "TEXT" },
  { label: "Email", value: "EMAIL" },
  { label: "Dropdown", value: "SELECT" },
  { label: "Checkbox", value: "CHECKBOX" },
  { label: "File upload (Growth)", value: "FILE" },
];

const TYPE_LABELS: Record<string, string> = {
  TEXT: "Text",
  EMAIL: "Email",
  SELECT: "Dropdown",
  CHECKBOX: "Checkbox",
  FILE: "File upload",
};

/** Read-only, selectable link with a Copy button (keyboard + screen-reader friendly). */
function CopyLinkField({ label, value, helpText }: { label: string; value: string; helpText?: string }) {
  const shopify = useAppBridge();
  const [copied, setCopied] = useState(false);
  return (
    <TextField
      label={label}
      value={value}
      readOnly
      autoComplete="off"
      helpText={helpText}
      selectTextOnFocus
      connectedRight={
        <Button
          accessibilityLabel={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard?.writeText(value);
              setCopied(true);
              shopify.toast.show("Link copied");
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
      }
    />
  );
}

export default function WholesaleFormEditor() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const submitting = navigation.state === "submitting";
  const publishing = submitting && navigation.formData?.get("intent") === "publish";

  const [label, setLabel] = useState("");
  const [type, setType] = useState("TEXT");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const [domains, setDomains] = useState(data.form.autoApproveDomains.join("\n"));

  const err = actionData && !actionData.ok ? actionData.error : null;
  const msg = actionData && actionData.ok ? actionData.message : null;

  // Page-wide action: publish state is the one thing that changes what buyers see.
  const togglePublish = () => {
    const fd = new FormData();
    fd.set("intent", "publish");
    fd.set("published", data.form.published ? "" : "on");
    submit(fd, { method: "post" });
  };

  return (
    <Page
      backAction={{ content: "Applications", url: "/app/wholesale" }}
      title={data.form.name}
      subtitle="Choose what buyers fill in when they apply for a wholesale account."
      titleMetadata={<Badge tone={data.form.published ? "success" : undefined}>{data.form.published ? "Published" : "Draft"}</Badge>}
      primaryAction={{
        content: data.form.published ? "Unpublish form" : "Publish form",
        onAction: togglePublish,
        loading: publishing,
        destructive: data.form.published,
      }}
    >
      <TitleBar title={data.form.name} />
      <BlockStack gap="500">
        {err && <Banner tone="critical" title="Couldn’t save"><p>{err}</p></Banner>}
        {msg && <Banner tone="success" title={msg} />}

        {/* Fields: the main job on this page */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Form fields</Text>
            {data.form.fields.length === 0 ? (
              <Text as="p" tone="subdued">
                This form has no fields yet, so buyers can only send their contact details. Add a field below.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "field", plural: "fields" }}
                itemCount={data.form.fields.length}
                selectable={false}
                headings={[{ title: "Label" }, { title: "Type" }, { title: "Required" }, { title: "Actions", hidden: true }]}
              >
                {data.form.fields.map((f, i) => (
                  <IndexTable.Row id={f.id} key={f.id} position={i}>
                    <IndexTable.Cell>{f.label}</IndexTable.Cell>
                    <IndexTable.Cell>{TYPE_LABELS[f.type] ?? f.type}</IndexTable.Cell>
                    <IndexTable.Cell>{f.required ? "Yes" : "No"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <ConfirmAction
                        label="Delete"
                        size="micro"
                        variant="plain"
                        title={`Delete “${f.label}”?`}
                        message="Buyers won't be asked this anymore. Answers already submitted stay on past applications."
                        confirmLabel="Delete field"
                        fields={{ intent: "delete-field", fieldId: f.id }}
                      />
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}

            <Form method="post">
              <input type="hidden" name="intent" value="add-field" />
              <InlineGrid columns={{ xs: 1, sm: "2fr 1fr auto" }} gap="200">
                <TextField label="Field label" name="label" value={label} onChange={setLabel} autoComplete="off" placeholder="e.g. Resale certificate #" />
                <Select label="Type" name="type" options={TYPE_OPTIONS} value={type} onChange={setType} />
                <Box paddingBlockStart="600"><Button submit loading={submitting && !publishing}>Add field</Button></Box>
              </InlineGrid>
              {type === "SELECT" && (
                <Box paddingBlockStart="200">
                  <TextField label="Dropdown options (one per line)" name="options" value={options} onChange={setOptions} multiline={3} autoComplete="off" />
                </Box>
              )}
              <Box paddingBlockStart="200">
                <Checkbox label="Required" name="required" checked={required} onChange={setRequired} />
              </Box>
            </Form>
          </BlockStack>
        </Card>

        {/* Share */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Share</Text>
            {data.form.published ? (
              <CopyLinkField
                label="Public application link"
                value={data.publicUrl}
                helpText="Share this link on your site or in emails. Buyers apply here."
              />
            ) : (
              <Text as="p" tone="subdued">
                This form is a draft. Publish it to get a public link buyers can apply through.
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* Auto-approval (Growth) — advanced, so it stays one click away */}
        <DisclosureCard
          title="Auto-approval"
          subtitle="Approve applicants from trusted email domains automatically."
          badge={<Badge tone="info">Growth</Badge>}
          defaultOpen={data.form.autoApproveDomains.length > 0}
        >
          {data.isGrowth ? (
            <Form method="post">
              <input type="hidden" name="intent" value="auto-approve" />
              <BlockStack gap="200">
                <TextField
                  label="Auto-approve email domains (one per line)"
                  name="domains"
                  value={domains}
                  onChange={setDomains}
                  multiline={3}
                  autoComplete="off"
                  helpText="Applications from these domains are approved automatically."
                  placeholder={"acme.com\npartner.co"}
                />
                <InlineStack><Button submit loading={submitting && !publishing}>Save rules</Button></InlineStack>
              </BlockStack>
            </Form>
          ) : (
            <Banner tone="warning">
              <p>Auto-approval rules and file-upload fields are a Growth feature.</p>
              <Box paddingBlockStart="200"><Button url={upgradeUrl("growth")} variant="primary">Upgrade to Growth</Button></Box>
            </Banner>
          )}
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
