import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Select, Checkbox, IndexTable, EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { GROWTH_PLAN } from "../lib/billing";
import { priceRuleScopeAllowed, type PriceScope } from "../lib/price-visibility";
import { QUOTE_CAPTURE_ENABLED, listPriceRules, savePriceRule, deletePriceRule, ScopeNotAllowedError } from "../services/price-visibility.server";

const IS_TEST = process.env.NODE_ENV !== "production";

const SCOPE_LABEL: Record<PriceScope, string> = {
  ALL: "Everyone",
  LOGGED_OUT: "Logged-out visitors",
  CUSTOMER_TAG: "Customer tag",
  PRODUCT: "Product",
  COLLECTION: "Collection",
};
const SCOPES: PriceScope[] = ["ALL", "LOGGED_OUT", "CUSTOMER_TAG", "PRODUCT", "COLLECTION"];
const needsRef = (s: PriceScope) => s === "CUSTOMER_TAG" || s === "PRODUCT" || s === "COLLECTION";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const rules = await listPriceRules(session.shop);
  return { rules, plan: status.plan };
};

type ActionResult = { ok: boolean; message?: string; error?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "delete") {
    await deletePriceRule(session.shop, String(form.get("id") ?? ""));
    return { ok: true, message: "Rule deleted." };
  }
  try {
    const res = await savePriceRule(session.shop, {
      scope: String(form.get("scope") ?? "ALL") as PriceScope,
      scopeRef: String(form.get("scopeRef") ?? ""),
      hidePrice: form.get("hidePrice") === "on",
      hideAtc: form.get("hideAtc") === "on",
      ctaLabel: String(form.get("ctaLabel") ?? ""),
      priority: Number(form.get("priority") ?? 0),
    });
    return "error" in res ? { ok: false, error: res.error } : { ok: true, message: "Rule saved." };
  } catch (error) {
    if (error instanceof ScopeNotAllowedError) return { ok: false, error: "Targeting by tag, product, or collection needs the Growth plan." };
    throw error;
  }
};

export default function PriceRules() {
  const { rules, plan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [scope, setScope] = useState<PriceScope>("LOGGED_OUT");
  const [scopeRef, setScopeRef] = useState("");
  const [hidePrice, setHidePrice] = useState(true);
  const [hideAtc, setHideAtc] = useState(false);
  const [ctaLabel, setCtaLabel] = useState("Request a Quote");
  const [priority, setPriority] = useState("0");

  const scopeOptions = SCOPES.map((s) => ({ label: SCOPE_LABEL[s] + (priceRuleScopeAllowed(plan, s) ? "" : " (Growth)"), value: s, disabled: !priceRuleScopeAllowed(plan, s) }));
  const scopeLocked = !priceRuleScopeAllowed(plan, scope);

  return (
    <Page>
      <TitleBar title="Price & Add-to-Cart rules" />
      <SectionTabs active="price-rules" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <Banner tone="info" title="Hide price or Add-to-Cart, show “Request a Quote” instead">
          <p>Rules are evaluated on the storefront by the theme app block. A hidden price is never sent to the browser — only the decision to hide it and your call-to-action label.</p>
        </Banner>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Your rules</Text>
            {rules.length === 0 ? (
              <EmptyState heading="No price rules yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Add a rule to hide price / Add-to-Cart for a given audience or catalog and invite a quote instead.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "rule", plural: "rules" }}
                itemCount={rules.length}
                selectable={false}
                headings={[{ title: "Scope" }, { title: "Hides" }, { title: "CTA" }, { title: "Priority" }, { title: "Status" }, { title: "" }]}
              >
                {rules.map((r, i) => (
                  <IndexTable.Row id={r.id} key={r.id} position={i}>
                    <IndexTable.Cell>{SCOPE_LABEL[r.scope]}{r.scopeRef ? `: ${r.scopeRef}` : ""}</IndexTable.Cell>
                    <IndexTable.Cell>{[r.hidePrice ? "price" : null, r.hideAtc ? "add-to-cart" : null].filter(Boolean).join(" + ") || "—"}</IndexTable.Cell>
                    <IndexTable.Cell>{r.ctaLabel}</IndexTable.Cell>
                    <IndexTable.Cell>{r.priority}</IndexTable.Cell>
                    <IndexTable.Cell><Badge tone={r.active ? "success" : undefined}>{r.active ? "Active" : "Off"}</Badge></IndexTable.Cell>
                    <IndexTable.Cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={r.id} />
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
          <Form method="post">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">New rule</Text>
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="16rem">
                  <Select label="Who / what" name="scope" options={scopeOptions} value={scope} onChange={(v) => setScope(v as PriceScope)} />
                </Box>
                {needsRef(scope) && (
                  <Box minWidth="16rem"><TextField label="Reference (tag / product GID / collection GID)" name="scopeRef" value={scopeRef} onChange={setScopeRef} autoComplete="off" /></Box>
                )}
                <Box minWidth="10rem"><TextField label="Priority" name="priority" type="number" value={priority} onChange={setPriority} autoComplete="off" /></Box>
              </InlineStack>
              <InlineStack gap="400" blockAlign="center" wrap>
                <Checkbox label="Hide price" checked={hidePrice} onChange={setHidePrice} />
                <input type="hidden" name="hidePrice" value={hidePrice ? "on" : "off"} />
                <Checkbox label="Hide Add-to-Cart" checked={hideAtc} onChange={setHideAtc} />
                <input type="hidden" name="hideAtc" value={hideAtc ? "on" : "off"} />
                <Box minWidth="16rem"><TextField label="Button label" name="ctaLabel" value={ctaLabel} onChange={setCtaLabel} autoComplete="off" /></Box>
              </InlineStack>
              {scopeLocked ? (
                <Banner tone="info"><p>Targeting by tag, product, or collection needs the Growth plan. Pick “Everyone” or “Logged-out visitors”, or <a href={`/app/settings?upgrade=${GROWTH_PLAN}`}>upgrade to Growth</a>.</p></Banner>
              ) : (
                <Box><Button submit variant="primary" disabled={busy}>Add rule</Button></Box>
              )}
            </BlockStack>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}
