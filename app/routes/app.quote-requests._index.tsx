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
  Checkbox,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { quoteWidgetFeatures, GROWTH_PLAN } from "../lib/billing";
import {
  getWidgetConfig,
  saveWidgetConfig,
  listQuoteRequests,
  convertToQuote,
  declineRequest,
} from "../services/quote-widget.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_QUOTE_WIDGET === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const [config, requests] = await Promise.all([getWidgetConfig(session.shop), listQuoteRequests(session.shop)]);
  return { isGrowth: status.plan === GROWTH_PLAN, features: quoteWidgetFeatures(status.plan), config, requests };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Response | ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  await requireBilling(billing, { isTest: IS_TEST });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save") {
    const fieldsRaw = String(form.get("customFields") ?? "").trim();
    let customFields: Array<{ key: string; label: string }> = [];
    for (const line of fieldsRaw.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const [key, ...rest] = line.split("=");
      if (key?.trim()) customFields.push({ key: key.trim(), label: (rest.join("=") || key).trim() });
    }
    await saveWidgetConfig(session.shop, {
      enabled: form.get("enabled") === "on",
      label: String(form.get("label") ?? ""),
      gated: form.get("gated") === "on",
      cartEnabled: form.get("cartEnabled") === "on",
      customFields,
    });
    return { ok: true, message: "Widget settings saved." };
  }
  if (intent === "convert") {
    const result = await convertToQuote(session.shop, String(form.get("id") ?? ""));
    if (!result.ok) return { ok: false, error: result.error };
    return redirect(`/app/quotes/${result.quoteId}`);
  }
  if (intent === "decline") {
    await declineRequest(session.shop, String(form.get("id") ?? ""));
    return { ok: true, message: "Request declined." };
  }
  return { ok: false, error: "Unknown action." };
};

const STATUS_TONE: Record<string, "success" | "attention" | "critical"> = { CONVERTED: "success", NEW: "attention", DECLINED: "critical" };

export default function QuoteRequests() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const c = data.config!;

  const [enabled, setEnabled] = useState(c.enabled);
  const [label, setLabel] = useState(c.label);
  const [gated, setGated] = useState(c.gated);
  const [cartEnabled, setCartEnabled] = useState(c.cartEnabled);
  const [fields, setFields] = useState(c.customFields.map((f) => `${f.key}=${f.label}`).join("\n"));

  return (
    <Page>
      <TitleBar title="Quote requests" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        <Text as="p" tone="subdued" variant="bodyMd">
          Add a “Request a Quote” button to your storefront (no code) and capture
          B2B leads straight into your quote pipeline. Convert a request to a real
          quote in one click — it enters the AI counter-offer flow.
        </Text>

        {/* Widget settings */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Storefront widget</Text>
              <InlineStack gap="400" blockAlign="center" wrap>
                <input type="hidden" name="enabled" value={enabled ? "on" : ""} />
                <Checkbox label="Enable the storefront widget" checked={enabled} onChange={setEnabled} />
                <Box minWidth="260px"><TextField label="Button label" name="label" value={label} onChange={setLabel} autoComplete="off" placeholder="Request a Quote" /></Box>
              </InlineStack>
              <InlineStack gap="400" blockAlign="center" wrap>
                <input type="hidden" name="gated" value={gated ? "on" : ""} />
                <Checkbox label="Gate to approved wholesale buyers" checked={gated} onChange={setGated} disabled={!data.features.gatedMode} helpText={data.features.gatedMode ? undefined : "Growth"} />
                <input type="hidden" name="cartEnabled" value={cartEnabled ? "on" : ""} />
                <Checkbox label="Cart-level requests" checked={cartEnabled} onChange={setCartEnabled} disabled={!data.features.cartLevel} helpText={data.features.cartLevel ? undefined : "Growth"} />
              </InlineStack>
              {data.features.customFields ? (
                <TextField label="Custom fields (one per line: key=Label)" name="customFields" value={fields} onChange={setFields} multiline={2} autoComplete="off" placeholder={"po_number=PO number\nrequired_by=Required by"} />
              ) : (
                <input type="hidden" name="customFields" value="" />
              )}
              <InlineStack gap="200" blockAlign="center">
                <Button variant="primary" submit loading={busy}>Save settings</Button>
                <Text as="span" tone="subdued" variant="bodySm">Then add the “Request a Quote” app block in your theme editor (Online Store → Customize).</Text>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* Requests inbox */}
        <Card padding="0">
          <Box padding="400"><Text as="h2" variant="headingMd">Requests</Text></Box>
          {data.requests.length === 0 ? (
            <EmptyState heading="No requests yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>When a visitor submits a quote request from your storefront, it lands here.</p>
            </EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: "request", plural: "requests" }} itemCount={data.requests.length} selectable={false} headings={[{ title: "From" }, { title: "Source" }, { title: "Items" }, { title: "Status" }, { title: "" }]}>
              {data.requests.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell>
                    {r.email}
                    {r.companyName && <><br /><Text as="span" tone="subdued" variant="bodySm">{r.companyName}</Text></>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{r.source}</IndexTable.Cell>
                  <IndexTable.Cell>{String(r.itemCount)}{r.note ? " + note" : ""}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={STATUS_TONE[r.status] ?? "attention"}>{r.status}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>
                    {r.status === "NEW" ? (
                      <InlineStack gap="150">
                        <Form method="post">
                          <input type="hidden" name="intent" value="convert" />
                          <input type="hidden" name="id" value={r.id} />
                          <Button submit size="micro" variant="primary" loading={busy}>Convert to quote</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="decline" />
                          <input type="hidden" name="id" value={r.id} />
                          <Button submit size="micro" variant="tertiary" tone="critical" loading={busy}>Decline</Button>
                        </Form>
                      </InlineStack>
                    ) : r.convertedQuoteId ? (
                      <Button url={`/app/quotes/${r.convertedQuoteId}`} size="micro" variant="tertiary">View quote</Button>
                    ) : null}
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
