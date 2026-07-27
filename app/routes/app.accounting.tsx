import { useState } from "react";
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
import { accountingSyncAllowed, GROWTH_PLAN } from "../lib/billing";
import { PROVIDERS, providerName, connectionHealth, type Provider } from "../lib/accounting";
import {
  listConnections,
  getMap,
  saveMap,
  listSyncLogs,
  retrySyncLog,
  disconnect,
  type MapView,
} from "../services/accounting.server";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_ACCOUNTING_SYNC === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = accountingSyncAllowed(status.plan);

  const connections = isGrowth ? await listConnections(session.shop) : [];
  const map: MapView = isGrowth
    ? await getMap(session.shop)
    : { taxCodeMap: {}, accountMap: {}, customerMatchStrategy: "EMAIL" };
  const logs = isGrowth ? await listSyncLogs(session.shop) : [];

  const now = new Date();
  return {
    isGrowth,
    plan: status.plan,
    connections: connections.map((c) => ({
      ...c,
      health: connectionHealth(c.status as never, c.expiresAt, now),
    })),
    map,
    logs,
    providers: PROVIDERS,
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!accountingSyncAllowed(status.plan)) {
    return { ok: false, error: "Accounting sync is a Growth feature." };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-map") {
    const parseJson = (raw: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const line of raw.split("\n")) {
        const [k, v] = line.split("=");
        if (k?.trim() && v?.trim()) out[k.trim()] = v.trim();
      }
      return out;
    };
    const map: MapView = {
      taxCodeMap: parseJson(String(form.get("taxCodeMap") ?? "")),
      accountMap: parseJson(String(form.get("accountMap") ?? "")),
      customerMatchStrategy: String(form.get("customerMatchStrategy") ?? "EMAIL") === "NAME" ? "NAME" : "EMAIL",
    };
    await saveMap(session.shop, map);
    return { ok: true, message: "Field mapping saved." };
  }

  if (intent === "retry") {
    const ok = await retrySyncLog(session.shop, String(form.get("logId") ?? ""));
    return ok
      ? { ok: true, message: "Queued for retry — it runs on the next sync pass." }
      : { ok: false, error: "That sync entry wasn’t found." };
  }

  if (intent === "disconnect") {
    await disconnect(session.shop, String(form.get("provider") ?? "") as Provider);
    return { ok: true, message: "Disconnected." };
  }

  return { ok: false, error: "Unknown action." };
};

const HEALTH_TONE: Record<string, "success" | "warning" | "critical"> = {
  CONNECTED: "success",
  EXPIRED: "warning",
  ERROR: "critical",
};
const STATUS_TONE: Record<string, "success" | "attention" | "critical"> = {
  SYNCED: "success",
  PENDING: "attention",
  FAILED: "critical",
};

export default function Accounting() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const toLines = (o: Record<string, string>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

  const [taxMap, setTaxMap] = useState(toLines(data.map.taxCodeMap));
  const [acctMap, setAcctMap] = useState(toLines(data.map.accountMap));
  const [matchStrategy, setMatchStrategy] = useState(data.map.customerMatchStrategy);

  const connByProvider = new Map(data.connections.map((c) => [c.provider, c]));

  if (!data.isGrowth) {
    return (
      <Page>
        <TitleBar title="Accounting sync" />
        <Banner tone="info" title="Connect your accounting — upgrade to Growth">
          <p>
            Push every Mannon invoice and payment into QuickBooks Online or Xero
            automatically — no re-keying. Accounting sync is included on the Growth
            plan.
          </p>
          <Box paddingBlockStart="200">
            <Button url="/app/settings?upgrade=Growth" variant="primary">
              See Growth
            </Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Accounting sync" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        <Text as="p" tone="subdued" variant="bodyMd">
          Orders land in your books automatically. Connect a provider, map your tax
          codes and income account once, and every net-terms invoice syncs — with a
          log you can retry if anything slips.
        </Text>

        {/* Connections */}
        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
          {data.providers.map((p) => {
            const conn = connByProvider.get(p.id as Provider);
            return (
              <Card key={p.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      {p.name}
                    </Text>
                    {conn ? (
                      <Badge tone={HEALTH_TONE[conn.health] ?? "attention"}>
                        {conn.health === "CONNECTED"
                          ? conn.sandbox
                            ? "Connected (test)"
                            : "Connected"
                          : conn.health === "EXPIRED"
                            ? "Reconnect needed"
                            : "Error"}
                      </Badge>
                    ) : (
                      <Badge>Not connected</Badge>
                    )}
                  </InlineStack>

                  {conn && conn.health === "EXPIRED" && (
                    <Banner tone="warning" title="Session expired">
                      <p>Reconnect {p.name} so syncing can resume.</p>
                    </Banner>
                  )}

                  <InlineStack gap="200">
                    <Button url={`/app/accounting-connect/${p.id.toLowerCase()}`} target="_top" variant={conn ? "secondary" : "primary"}>
                      {conn ? `Reconnect ${p.name}` : `Connect ${p.name}`}
                    </Button>
                    {conn && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="disconnect" />
                        <input type="hidden" name="provider" value={p.id} />
                        <Button submit tone="critical" variant="tertiary" loading={busy}>
                          Disconnect
                        </Button>
                      </Form>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>

        {/* Field mapping */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save-map" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Field mapping
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                One entry per line as <code>key=value</code>. Use <code>default</code> as
                the tax key for a catch-all, and <code>income</code> in accounts for the
                default sales account.
              </Text>
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <TextField
                  label="Tax code map"
                  name="taxCodeMap"
                  value={taxMap}
                  onChange={setTaxMap}
                  multiline={4}
                  autoComplete="off"
                  placeholder={"default=TAX\nzero-rated=NON"}
                />
                <TextField
                  label="Account map"
                  name="accountMap"
                  value={acctMap}
                  onChange={setAcctMap}
                  multiline={4}
                  autoComplete="off"
                  placeholder={"income=200"}
                />
              </InlineGrid>
              <Select
                label="Match customers by"
                name="customerMatchStrategy"
                options={[
                  { label: "Email (recommended)", value: "EMAIL" },
                  { label: "Name", value: "NAME" },
                ]}
                value={matchStrategy}
                onChange={(v) => setMatchStrategy(v as MapView["customerMatchStrategy"])}
              />
              <InlineStack>
                <Button variant="primary" submit loading={busy}>
                  Save mapping
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* Sync log */}
        <Card padding="0">
          <Box padding="400">
            <Text as="h2" variant="headingMd">
              Sync log
            </Text>
          </Box>
          {data.logs.length === 0 ? (
            <EmptyState
              heading="Nothing synced yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>When a net-terms order raises an invoice, it appears here as it syncs.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "sync", plural: "syncs" }}
              itemCount={data.logs.length}
              selectable={false}
              headings={[
                { title: "Provider" },
                { title: "Entity" },
                { title: "Status" },
                { title: "Remote id" },
                { title: "Detail" },
                { title: "" },
              ]}
            >
              {data.logs.map((l, i) => (
                <IndexTable.Row id={l.id} key={l.id} position={i}>
                  <IndexTable.Cell>{providerName(l.provider)}</IndexTable.Cell>
                  <IndexTable.Cell>{l.entity}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={STATUS_TONE[l.status] ?? "attention"}>{l.status}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{l.remoteId ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone={l.status === "FAILED" ? "critical" : "subdued"} variant="bodySm">
                      {l.error ?? (l.status === "SYNCED" ? "Synced" : `Attempt ${l.attempts}`)}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {l.status === "FAILED" && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="retry" />
                        <input type="hidden" name="logId" value={l.id} />
                        <Button submit size="micro" loading={busy}>
                          Retry
                        </Button>
                      </Form>
                    )}
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
