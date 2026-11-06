import { useState } from "react";
import { storefrontBlockLinks } from "../lib/theme-deep-links";
import { StorefrontSetupCard } from "../components/StorefrontSetupCard";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Select, Checkbox, IndexTable, EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { DisclosureCard } from "../components/DisclosureCard";
import { ConfirmAction } from "../components/ConfirmAction";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { GROWTH_PLAN, STARTER_PLAN } from "../lib/billing";
import { priceRuleScopeAllowed, type PriceScope } from "../lib/price-visibility";
import { QUOTE_CAPTURE_ENABLED, listPriceRules, savePriceRule, deletePriceRule, ScopeNotAllowedError, priceRulePlanFor } from "../services/price-visibility.server";
import { upgradeUrl } from "../lib/upgrade";

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
const REF_FIELD: Partial<Record<PriceScope, { label: string; placeholder: string }>> = {
  CUSTOMER_TAG: { label: "Customer tag", placeholder: "e.g. wholesale" },
  PRODUCT: { label: "Product ID", placeholder: "gid://shopify/Product/123" },
  COLLECTION: { label: "Collection ID", placeholder: "gid://shopify/Collection/123" },
};
const SCOPE_FIELD_ID = "price-rule-scope";

/** Move focus to the create form's first field (EmptyState action). */
function focusField(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.focus();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!QUOTE_CAPTURE_ENABLED()) throw new Response("Not found", { status: 404 });
  await requireBilling(billing, { isTest: IS_TEST });
  const rules = await listPriceRules(session.shop);
  // Same plan source as the save path (the shop's stored v3 plan), so the form
  // never locks a scope the server would accept, or the other way round.
  const { plan, legacy } = await priceRulePlanFor(session.shop);
  return { rules, plan, legacy, themeLinks: storefrontBlockLinks(session.shop, process.env.SHOPIFY_API_KEY, ["price_gate"]) };
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
  const { rules, plan, legacy, themeLinks } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const [scope, setScope] = useState<PriceScope>("LOGGED_OUT");
  const [scopeRef, setScopeRef] = useState("");
  const [hidePrice, setHidePrice] = useState(true);
  const [hideAtc, setHideAtc] = useState(false);
  const [ctaLabel, setCtaLabel] = useState("Request a Quote");
  const [priority, setPriority] = useState("0");

  const scopeOptions = SCOPES.map((s) => ({ label: SCOPE_LABEL[s] + (priceRuleScopeAllowed(plan, s, legacy) ? "" : s === "ALL" || s === "LOGGED_OUT" ? " (Starter)" : " (Growth)"), value: s, disabled: !priceRuleScopeAllowed(plan, s, legacy) }));
  const scopeLocked = !priceRuleScopeAllowed(plan, scope, legacy);
  const refField = REF_FIELD[scope];
  const firstRun = rules.length === 0;

  return (
    <Page>
      <TitleBar title="Price rules" />
      <SectionTabs active="price-rules" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        {/* 1. The list the merchant works in */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Your rules</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Hide the price or the Add to cart button for an audience and show a quote button instead.
              </Text>
            </BlockStack>
          </Box>
          {firstRun ? (
            <EmptyState
              heading="No price rules yet"
              action={{ content: "Add a rule", onAction: () => focusField(SCOPE_FIELD_ID) }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Every visitor sees your prices until you add a rule. Start with logged-out visitors to keep wholesale prices private.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "rule", plural: "rules" }}
              itemCount={rules.length}
              selectable={false}
              headings={[{ title: "Applies to" }, { title: "Hides" }, { title: "Button label" }, { title: "Priority" }, { title: "Status" }, { title: "Actions", hidden: true }]}
            >
              {rules.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell>{SCOPE_LABEL[r.scope]}{r.scopeRef ? `: ${r.scopeRef}` : ""}</IndexTable.Cell>
                  <IndexTable.Cell>{[r.hidePrice ? "Price" : null, r.hideAtc ? "Add to cart" : null].filter(Boolean).join(", ") || "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{r.ctaLabel}</IndexTable.Cell>
                  <IndexTable.Cell>{r.priority}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={r.active ? "success" : undefined}>{r.active ? "Active" : "Off"}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>
                    <ConfirmAction
                      label="Delete"
                      title="Delete this price rule?"
                      message={`${SCOPE_LABEL[r.scope]}${r.scopeRef ? ` (${r.scopeRef})` : ""} will see prices and Add to cart again, unless another rule hides them.`}
                      confirmLabel="Delete rule"
                      fields={{ intent: "delete", id: r.id }}
                      size="micro"
                      variant="tertiary"
                      disabled={busy}
                    />
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* 2. Create */}
        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Add a rule</Text>
              <InlineStack gap="300" blockAlign="end" wrap>
                <Box minWidth="16rem">
                  <Select id={SCOPE_FIELD_ID} label="Applies to" name="scope" options={scopeOptions} value={scope} onChange={(v) => setScope(v as PriceScope)} />
                </Box>
                {needsRef(scope) && refField && (
                  <Box minWidth="16rem">
                    <TextField label={refField.label} name="scopeRef" value={scopeRef} onChange={setScopeRef} autoComplete="off" placeholder={refField.placeholder} />
                  </Box>
                )}
                <Box minWidth="10rem">
                  <TextField label="Priority" name="priority" type="number" value={priority} onChange={setPriority} autoComplete="off" helpText="When rules overlap, the higher number wins." />
                </Box>
              </InlineStack>
              <InlineStack gap="400" blockAlign="center" wrap>
                <Checkbox label="Hide price" checked={hidePrice} onChange={setHidePrice} />
                <input type="hidden" name="hidePrice" value={hidePrice ? "on" : "off"} />
                <Checkbox label="Hide Add to cart" checked={hideAtc} onChange={setHideAtc} />
                <input type="hidden" name="hideAtc" value={hideAtc ? "on" : "off"} />
                <Box minWidth="16rem"><TextField label="Button label" name="ctaLabel" value={ctaLabel} onChange={setCtaLabel} autoComplete="off" helpText="Shown where the price or Add to cart button was." /></Box>
              </InlineStack>
              {scopeLocked ? (
                scope === "ALL" || scope === "LOGGED_OUT" ? (
                  <Banner tone="info" action={{ content: "See plans", url: upgradeUrl(STARTER_PLAN) }}>
                    <p>Price rules come with the Starter plan and above.</p>
                  </Banner>
                ) : (
                  <Banner tone="info" action={{ content: "Upgrade to Growth", url: upgradeUrl(GROWTH_PLAN) }}>
                    <p>Targeting by tag, product, or collection needs the Growth plan. Pick “Everyone” or “Logged-out visitors” instead, or upgrade.</p>
                  </Banner>
                )
              ) : (
                <Box><Button submit variant="primary" disabled={busy}>Add rule</Button></Box>
              )}
            </BlockStack>
          </Form>
        </Card>

        {/* 3. Setup + explanation, one click away (open on first run) */}
        <DisclosureCard
          title="Add the price gate to your storefront"
          subtitle="Rules run on your storefront through the price gate theme block."
          defaultOpen={firstRun}
        >
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              A hidden price is never sent to the browser. Your storefront only receives the decision to hide it and your button label.
            </Text>
            <StorefrontSetupCard bare links={themeLinks} />
          </BlockStack>
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
