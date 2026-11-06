import { useMemo, useState } from "react";
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
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { DisclosureCard } from "../components/DisclosureCard";
import { ConfirmAction } from "../components/ConfirmAction";
import prisma from "../db.server";
import { upgradeUrl } from "../lib/upgrade";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { allowedRuleScopes, packRulesAllowed, GROWTH_PLAN } from "../lib/billing";
import {
  listRules,
  createRule,
  deleteRule,
  parseRulesCsv,
  importRulesCsv,
  getRulesForShop,
  RuleScopeNotAllowedError,
  type RuleInput,
} from "../services/order-rules.server";
import { evaluateCart, type OrderRuleLite } from "../lib/order-rules";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_MOQ === "true";
const SCOPE_FIELD_ID = "order-rule-scope";

const SCOPE_LABEL: Record<string, string> = {
  STORE: "Whole store",
  PRODUCT: "Product variant",
  COLLECTION: "Collection",
  CUSTOMER_GROUP: "Company",
};
const TARGET_FIELD: Record<string, { label: string; placeholder: string }> = {
  PRODUCT: { label: "Variant ID", placeholder: "gid://shopify/ProductVariant/123" },
  COLLECTION: { label: "Collection ID", placeholder: "gid://shopify/Collection/123" },
};

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
  const rules = await listRules(session.shop);
  const rulesLite = await getRulesForShop(session.shop);
  // CUSTOMER_GROUP rules target a company (docs/order-rules.md: the F5 company is
  // the "group"), so the editor offers a company picker instead of a raw id.
  const companies = await prisma.company.findMany({
    where: { shop: { shopifyDomain: session.shop } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 250,
  });
  return {
    companies,
    isGrowth: status.plan === GROWTH_PLAN,
    scopes: allowedRuleScopes(status.plan),
    packsAllowed: packRulesAllowed(status.plan),
    rules,
    rulesLite,
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  await requireBilling(billing, { isTest: IS_TEST });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "create") {
      const num = (k: string) => {
        const v = String(form.get(k) ?? "").trim();
        return v === "" ? null : Number(v);
      };
      const input: RuleInput = {
        scope: String(form.get("scope") ?? "STORE") as RuleInput["scope"],
        targetId: String(form.get("targetId") ?? "").trim() || null,
        minQty: num("minQty"),
        packSize: num("packSize"),
        minOrderValue: num("minOrderValue"),
        priority: Number(form.get("priority")) || 0,
      };
      await createRule(session.shop, input);
      return { ok: true, message: "Rule added." };
    }
    if (intent === "delete") {
      await deleteRule(session.shop, String(form.get("ruleId") ?? ""));
      return { ok: true, message: "Rule removed." };
    }
    if (intent === "import-csv") {
      const { rows, errors } = parseRulesCsv(String(form.get("csv") ?? ""));
      if (rows.length === 0) return { ok: false, error: `No valid rows. ${errors.slice(0, 2).join(" ")}` };
      const n = await importRulesCsv(session.shop, rows);
      return { ok: true, message: `Imported ${n} rule(s).${errors.length ? ` ${errors.length} skipped.` : ""}` };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof RuleScopeNotAllowedError) return { ok: false, error: "That scope or pack size needs Growth." };
    throw error;
  }
};

export default function OrderRules() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const [scope, setScope] = useState<string>(data.scopes[0]);
  const [targetId, setTargetId] = useState("");
  const [minQty, setMinQty] = useState("");
  const [packSize, setPackSize] = useState("");
  const [minOrderValue, setMinOrderValue] = useState("");
  const [priority, setPriority] = useState("0");
  const [csv, setCsv] = useState("");

  // Test-this-cart preview.
  const [testVariant, setTestVariant] = useState("");
  const [testQty, setTestQty] = useState("20");
  const [testPrice, setTestPrice] = useState("5");
  const preview = useMemo(() => {
    const q = Number(testQty) || 0;
    const p = Number(testPrice) || 0;
    if (!testVariant) return null;
    return evaluateCart([{ variantId: testVariant, qty: q, price: p }], data.rulesLite as OrderRuleLite[], {});
  }, [testVariant, testQty, testPrice, data.rulesLite]);

  const err = actionData && !actionData.ok ? actionData.error : null;
  const msg = actionData && actionData.ok ? actionData.message : null;
  const firstRun = data.rules.length === 0;

  const scopeOptions = data.scopes.map((s) => ({ label: SCOPE_LABEL[s] ?? s, value: s }));
  const companyName = (id: string | null) => (id ? data.companies.find((c) => c.id === id)?.name ?? id : "—");
  const onScopeChange = (v: string) => {
    setScope(v);
    setTargetId("");
  };

  return (
    <Page>
      <TitleBar title="Order rules" />
      <SectionTabs active="order-rules" />
      <BlockStack gap="500">
        {err && <Banner tone="critical" title="Couldn’t save"><p>{err}</p></Banner>}
        {msg && <Banner tone="success" title={msg} />}

        {/* 1. The list the merchant works in */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Your rules</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Rules apply in the portal cart, the order pad, and when a quote becomes an order. The most specific rule wins.
              </Text>
            </BlockStack>
          </Box>
          {firstRun ? (
            <EmptyState
              heading="No order rules yet"
              action={{ content: "Add a rule", onAction: () => focusField(SCOPE_FIELD_ID) }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Buyers can order any quantity at any value until you add a rule. Set a minimum quantity, a pack size, or an order-value minimum so invalid orders can’t slip through.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "rule", plural: "rules" }}
              itemCount={data.rules.length}
              selectable={false}
              headings={[{ title: "Applies to" }, { title: "Target" }, { title: "Min quantity" }, { title: "Pack size" }, { title: "Min order value" }, { title: "Actions", hidden: true }]}
            >
              {data.rules.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell><Badge>{SCOPE_LABEL[r.scope] ?? r.scope}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm" breakWord>
                      {r.scope === "CUSTOMER_GROUP" ? companyName(r.targetId) : r.targetId ?? "—"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{r.minQty ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{r.packSize ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{r.minOrderValue ? `$${Number(r.minOrderValue).toFixed(2)}` : "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <ConfirmAction
                      label="Delete"
                      title="Delete this order rule?"
                      message="Buyers will no longer be held to this minimum or pack size. Orders already placed aren’t changed."
                      confirmLabel="Delete rule"
                      fields={{ intent: "delete", ruleId: r.id }}
                      size="micro"
                      variant="tertiary"
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
            <input type="hidden" name="intent" value="create" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Add a rule</Text>
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <Select id={SCOPE_FIELD_ID} label="Applies to" name="scope" options={scopeOptions} value={scope} onChange={onScopeChange} />
                {scope === "STORE" ? (
                  <TextField label="Target" value="" onChange={() => {}} autoComplete="off" disabled helpText="Store-wide rules apply to every order." />
                ) : scope === "CUSTOMER_GROUP" ? (
                  data.companies.length === 0 ? (
                    <TextField label="Company" value="" onChange={() => {}} autoComplete="off" disabled helpText="You don’t have any companies yet. They appear here once you add B2B buyers." />
                  ) : (
                    <Select
                      label="Company"
                      name="targetId"
                      options={[{ label: "Choose a company…", value: "" }, ...data.companies.map((c) => ({ label: c.name, value: c.id }))]}
                      value={targetId}
                      onChange={setTargetId}
                    />
                  )
                ) : (
                  <TextField
                    label={TARGET_FIELD[scope]?.label ?? "Target"}
                    name="targetId"
                    value={targetId}
                    onChange={setTargetId}
                    autoComplete="off"
                    placeholder={TARGET_FIELD[scope]?.placeholder}
                  />
                )}
              </InlineGrid>
              <InlineGrid columns={{ xs: 1, sm: 4 }} gap="300">
                <TextField label="Min quantity" type="number" name="minQty" value={minQty} onChange={setMinQty} min={0} autoComplete="off" helpText="Per line" />
                <TextField label="Pack size" type="number" name="packSize" value={packSize} onChange={setPackSize} min={0} autoComplete="off" disabled={!data.packsAllowed} helpText={data.packsAllowed ? "Quantities round up to this" : "Needs Growth"} />
                <TextField label="Min order value" type="number" name="minOrderValue" value={minOrderValue} onChange={setMinOrderValue} min={0} step={0.01} prefix="$" autoComplete="off" />
                <TextField label="Priority" type="number" name="priority" value={priority} onChange={setPriority} autoComplete="off" helpText="Higher wins on a tie" />
              </InlineGrid>
              {!data.isGrowth && (
                <Banner tone="info" action={{ content: "Upgrade to Growth", url: upgradeUrl("growth") }}>
                  <p>Starter covers whole-store and product rules. Growth adds collection and company rules, pack sizes, and CSV import.</p>
                </Banner>
              )}
              <InlineStack><Button variant="primary" submit loading={busy}>Add rule</Button></InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* 3. Tools, one click away */}
        <DisclosureCard
          title="Test a cart"
          subtitle="See what your rules do to a cart line before a buyer does."
        >
          <BlockStack gap="300">
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <TextField label="Variant ID" value={testVariant} onChange={setTestVariant} autoComplete="off" placeholder="gid://shopify/ProductVariant/123" />
              <TextField label="Quantity" type="number" value={testQty} onChange={setTestQty} autoComplete="off" />
              <TextField label="Unit price" type="number" value={testPrice} onChange={setTestPrice} prefix="$" autoComplete="off" />
            </InlineGrid>
            {preview ? (
              <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                <BlockStack gap="150">
                  <Text as="p">
                    Quantity <b>{preview.lines[0].requestedQty}</b> → <b>{preview.lines[0].finalQty}</b>
                    {preview.lines[0].reason ? ` (${preview.lines[0].reason})` : " (no change)"}
                  </Text>
                  <Text as="p">
                    Subtotal ${preview.subtotal.toFixed(2)}
                    {preview.minOrderValue != null && (preview.ok
                      ? " · meets the minimum"
                      : ` · ${(preview.shortfall).toFixed(2)} under the $${preview.minOrderValue.toFixed(2)} minimum`)}
                  </Text>
                </BlockStack>
              </Box>
            ) : (
              <Text as="p" tone="subdued" variant="bodySm">Enter a variant ID to see the result. This is a preview only; nothing is saved.</Text>
            )}
          </BlockStack>
        </DisclosureCard>

        <DisclosureCard
          title="Bulk import (CSV)"
          subtitle="Add many rules at once."
          badge={<Badge tone="info">Growth</Badge>}
        >
          {data.isGrowth ? (
            <Form method="post">
              <input type="hidden" name="intent" value="import-csv" />
              <BlockStack gap="200">
                <TextField
                  label="Paste CSV (scope,target_id,min_qty,pack_size,min_order_value,priority)"
                  name="csv"
                  value={csv}
                  onChange={setCsv}
                  multiline={4}
                  autoComplete="off"
                  placeholder={"PRODUCT,gid://shopify/ProductVariant/1,,12,,0\nSTORE,,,,250,0"}
                  helpText="For CUSTOMER_GROUP rows, target_id is the company’s Mannon ID."
                />
                <InlineStack><Button submit loading={busy}>Import CSV</Button></InlineStack>
              </BlockStack>
            </Form>
          ) : (
            <Banner tone="info" action={{ content: "Upgrade to Growth", url: upgradeUrl("growth") }}>
              <p>CSV import comes with the Growth plan.</p>
            </Banner>
          )}
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
