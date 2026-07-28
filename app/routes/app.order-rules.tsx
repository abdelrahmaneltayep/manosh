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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const rules = await listRules(session.shop);
  const rulesLite = await getRulesForShop(session.shop);
  return {
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

  const scopeOptions = data.scopes.map((s) => ({ label: s.replace("_", " "), value: s }));

  return (
    <Page>
      <TitleBar title="Order rules" />
      <BlockStack gap="500">
        {err && <Banner tone="critical" title="Couldn’t save"><p>{err}</p></Banner>}
        {msg && <Banner tone="success" title={msg} />}

        {data.rules.length === 0 && (
          <Banner tone="info" title="Set your order minimums">
            <p>Add MOQ, pack/case sizes, and an order-value minimum so no unprofitable or invalid order slips through. Rules apply in the portal cart, the order pad, and quote conversion.</p>
          </Banner>
        )}

        {/* Create */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Add a rule</Text>
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <Select label="Scope" name="scope" options={scopeOptions} value={scope} onChange={setScope} />
                <TextField
                  label={scope === "PRODUCT" ? "Variant id" : scope === "CUSTOMER_GROUP" ? "Company id" : scope === "COLLECTION" ? "Collection id" : "Target (store-wide — leave blank)"}
                  name="targetId"
                  value={targetId}
                  onChange={setTargetId}
                  autoComplete="off"
                  disabled={scope === "STORE"}
                  placeholder={scope === "PRODUCT" ? "gid://shopify/ProductVariant/…" : ""}
                />
              </InlineGrid>
              <InlineGrid columns={{ xs: 1, sm: 4 }} gap="300">
                <TextField label="Min qty (MOQ)" type="number" name="minQty" value={minQty} onChange={setMinQty} min={0} autoComplete="off" />
                <TextField label="Pack size" type="number" name="packSize" value={packSize} onChange={setPackSize} min={0} autoComplete="off" disabled={!data.packsAllowed} helpText={data.packsAllowed ? undefined : "Growth"} />
                <TextField label="Min order value" type="number" name="minOrderValue" value={minOrderValue} onChange={setMinOrderValue} min={0} step={0.01} prefix="$" autoComplete="off" />
                <TextField label="Priority" type="number" name="priority" value="0" autoComplete="off" />
              </InlineGrid>
              {!data.isGrowth && (
                <Text as="p" tone="subdued" variant="bodySm">
                  Starter supports store + product rules. Upgrade to Growth for collection / customer-group scopes, pack sizes, and CSV import.
                </Text>
              )}
              <InlineStack><Button variant="primary" submit loading={busy}>Add rule</Button></InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* Rules table */}
        <Card padding="0">
          <Box padding="400"><Text as="h2" variant="headingMd">Rules</Text></Box>
          {data.rules.length === 0 ? (
            <EmptyState heading="No rules yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Add a rule above to enforce minimums and pack sizes.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "rule", plural: "rules" }}
              itemCount={data.rules.length}
              selectable={false}
              headings={[{ title: "Scope" }, { title: "Target" }, { title: "MOQ" }, { title: "Pack" }, { title: "Min value" }, { title: "" }]}
            >
              {data.rules.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell><Badge>{r.scope.replace("_", " ")}</Badge></IndexTable.Cell>
                  <IndexTable.Cell><Text as="span" variant="bodySm" breakWord>{r.targetId ?? "—"}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{r.minQty ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{r.packSize ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{r.minOrderValue ? `$${Number(r.minOrderValue).toFixed(2)}` : "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="ruleId" value={r.id} />
                      <Button size="slim" variant="plain" tone="critical" submit>Delete</Button>
                    </Form>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>

        {/* Test this cart */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Test this cart</Text>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <TextField label="Variant id" value={testVariant} onChange={setTestVariant} autoComplete="off" placeholder="gid://…/ProductVariant/123" />
              <TextField label="Quantity" type="number" value={testQty} onChange={setTestQty} autoComplete="off" />
              <TextField label="Unit price" type="number" value={testPrice} onChange={setTestPrice} prefix="$" autoComplete="off" />
            </InlineGrid>
            {preview && (
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
            )}
          </BlockStack>
        </Card>

        {/* CSV (Growth) */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">Bulk import (CSV)</Text>
              <Badge tone="info">Growth</Badge>
            </InlineStack>
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
                    placeholder={"PRODUCT,gid://…/ProductVariant/1,,12,,0\nSTORE,,,,250,0"}
                  />
                  <InlineStack><Button submit loading={busy}>Import CSV</Button></InlineStack>
                </BlockStack>
              </Form>
            ) : (
              <Text as="p" tone="subdued">CSV import is a Growth feature.</Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
