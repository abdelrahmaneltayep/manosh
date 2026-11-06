import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
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
import { ConfirmAction } from "../components/ConfirmAction";
import { DisclosureCard } from "../components/DisclosureCard";
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
import { upgradeUrl } from "../lib/upgrade";

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
const STATUS_LABELS: Record<string, string> = { SYNCED: "Synced", PENDING: "Pending", FAILED: "Failed" };

/**
 * The OAuth start (app.accounting-connect.$provider) and the public callback
 * (accounting.callback.$provider) bounce back here with `?connected=<provider>`
 * or `?error=<provider>_<code>`. Turn those into plain-language banners.
 */
function oauthResult(params: URLSearchParams): { tone: "success" | "critical"; title: string; body?: string } | null {
  const nameOf = (raw: string) => providerName(raw.toUpperCase() as Provider);
  const connected = params.get("connected");
  if (connected) {
    return {
      tone: "success",
      title: `${nameOf(connected)} connected`,
      body: "New net-terms invoices and payments will sync automatically. Check the sync log below.",
    };
  }
  const error = params.get("error");
  if (!error) return null;
  const m = /^([a-z]+)_(.+)$/.exec(error);
  const name = m ? nameOf(m[1]) : "your accounting provider";
  const code = m ? m[2] : error;
  if (code === "not_configured") {
    return {
      tone: "critical",
      title: `${name} isn’t available yet`,
      body: `The ${name} connection hasn’t been set up for this app yet, so you can’t connect right now. Nothing was changed.`,
    };
  }
  if (code === "denied") {
    return {
      tone: "critical",
      title: `${name} wasn’t connected`,
      body: `Access wasn’t granted in ${name}. To connect, try again and choose Allow or Connect when ${name} asks.`,
    };
  }
  if (code === "exchange_failed") {
    return {
      tone: "critical",
      title: `Couldn’t finish connecting ${name}`,
      body: `${name} approved the connection, but we couldn’t complete it. Please try again in a few minutes.`,
    };
  }
  return {
    tone: "critical",
    title: "Couldn’t connect your accounting provider",
    body: "Something went wrong while connecting. Please try again.",
  };
}

export default function Accounting() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const busyIntent = busy ? String(navigation.formData?.get("intent") ?? "") : "";
  const [searchParams, setSearchParams] = useSearchParams();
  const oauth = oauthResult(searchParams);

  const toLines = (o: Record<string, string>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

  const [taxMap, setTaxMap] = useState(toLines(data.map.taxCodeMap));
  const [acctMap, setAcctMap] = useState(toLines(data.map.accountMap));
  const [matchStrategy, setMatchStrategy] = useState(data.map.customerMatchStrategy);

  const connByProvider = new Map(data.connections.map((c) => [c.provider, c]));
  const hasMapping = Object.keys(data.map.taxCodeMap).length > 0 || Object.keys(data.map.accountMap).length > 0;

  const dismissOauth = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("error");
    setSearchParams(next, { replace: true });
  };

  if (!data.isGrowth) {
    return (
      <Page>
        <TitleBar title="Accounting" />
        <SectionTabs active="accounting" />
        <Banner tone="info" title="Connect your accounting — upgrade to Growth">
          <p>
            Push every Mannon invoice and payment into QuickBooks Online or Xero
            automatically — no re-keying. Accounting sync is included on the Growth
            plan.
          </p>
          <Box paddingBlockStart="200">
            <Button url={upgradeUrl("growth")} variant="primary">
              See Growth
            </Button>
          </Box>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Accounting" />
      <SectionTabs active="accounting" />
      <BlockStack gap="500">
        {oauth && (
          <Banner tone={oauth.tone} title={oauth.title} onDismiss={dismissOauth}>
            {oauth.body && <p>{oauth.body}</p>}
          </Banner>
        )}
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        {/* 1. Connections */}
        <BlockStack gap="200">
          <Text as="p" tone="subdued" variant="bodyMd">
            Connect a provider and every net-terms invoice and payment lands in your books automatically.
          </Text>
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
            {data.providers.map((p) => {
              const conn = connByProvider.get(p.id as Provider);
              return (
                <Card key={p.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
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

                    <InlineStack gap="200" blockAlign="center">
                      <Button url={`/app/accounting-connect/${p.id.toLowerCase()}`} target="_top" variant={conn ? "secondary" : "primary"}>
                        {conn ? `Reconnect ${p.name}` : `Connect ${p.name}`}
                      </Button>
                      {conn && (
                        <ConfirmAction
                          label="Disconnect"
                          variant="tertiary"
                          title={`Disconnect ${p.name}?`}
                          message={`New invoices and payments stop syncing to ${p.name}. Records already synced stay in ${p.name}.`}
                          confirmLabel={`Disconnect ${p.name}`}
                          fields={{ intent: "disconnect", provider: p.id }}
                        />
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </BlockStack>

        {/* 2. Sync log */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Sync log
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Every invoice and payment we send, with a retry if anything slips.
              </Text>
            </BlockStack>
          </Box>
          {data.logs.length === 0 ? (
            <EmptyState
              heading="Nothing synced yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                {data.connections.length === 0
                  ? "Connect QuickBooks Online or Xero above. Invoices from net-terms orders will appear here as they sync."
                  : "When a net-terms order raises an invoice, it appears here as it syncs."}
              </p>
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
                { title: "Remote ID" },
                { title: "Detail" },
                { title: "Actions", hidden: true },
              ]}
            >
              {data.logs.map((l, i) => (
                <IndexTable.Row id={l.id} key={l.id} position={i}>
                  <IndexTable.Cell>{providerName(l.provider)}</IndexTable.Cell>
                  <IndexTable.Cell>{l.entity}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={STATUS_TONE[l.status] ?? "attention"}>{STATUS_LABELS[l.status] ?? l.status}</Badge>
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
                        <Button
                          submit
                          size="micro"
                          accessibilityLabel={`Retry sync for ${l.entity}`}
                          loading={busyIntent === "retry" && navigation.formData?.get("logId") === l.id}
                        >
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

        {/* 3. Field mapping — set once, then rarely touched */}
        <DisclosureCard
          title="Field mapping"
          subtitle="Match your tax codes, income account and customers to your books."
          defaultOpen={data.connections.length > 0 && !hasMapping}
        >
          <Form method="post">
            <input type="hidden" name="intent" value="save-map" />
            <BlockStack gap="300">
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
                <Button variant="primary" submit loading={busyIntent === "save-map"}>
                  Save mapping
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
