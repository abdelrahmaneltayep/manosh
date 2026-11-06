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
  EmptyState,
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { ConfirmAction } from "../components/ConfirmAction";
import { DisclosureCard } from "../components/DisclosureCard";
import { SUPPORT_EMAIL } from "../lib/legal";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { erpSyncAllowed, GROWTH_PLAN } from "../lib/billing";
import { ERP_KINDS, erpKindName, syncLagExceeded, type ErpKind } from "../lib/erp";
import {
  getConnection,
  saveConnection,
  disconnect,
  listSyncLogs,
  retrySyncLog,
  applyStockUpdate,
  runExportForShop,
  makeConnector,
} from "../services/erp.server";
import { upgradeUrl } from "../lib/upgrade";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_ERP_SYNC === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = erpSyncAllowed(status.plan);
  if (!isGrowth) return { isGrowth, connection: null, logs: [], lagging: false, kinds: ERP_KINDS };

  const [connection, logs] = await Promise.all([getConnection(session.shop), listSyncLogs(session.shop)]);
  return {
    isGrowth,
    connection,
    logs,
    lagging: connection ? syncLagExceeded(connection.lastSyncAt, new Date(), 120) : false,
    kinds: ERP_KINDS,
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!erpSyncAllowed(status.plan)) return { ok: false, error: "ERP sync is a Growth feature." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save") {
    let config: Record<string, unknown> = {};
    try {
      const raw = String(form.get("config") ?? "").trim();
      config = raw ? JSON.parse(raw) : {};
    } catch {
      return { ok: false, error: "Field mapping must be valid JSON." };
    }
    await saveConnection(session.shop, {
      kind: String(form.get("kind") ?? "WEBHOOK") as ErpKind,
      endpoint: String(form.get("endpoint") ?? ""),
      secret: String(form.get("secret") ?? "") || null,
      sandbox: form.get("sandbox") === "on",
      sourceOfTruth: String(form.get("sourceOfTruth") ?? "SHOPIFY") === "ERP" ? "ERP" : "SHOPIFY",
      config,
    });
    return { ok: true, message: "ERP connection saved." };
  }
  if (intent === "disconnect") {
    await disconnect(session.shop);
    return { ok: true, message: "Disconnected." };
  }
  if (intent === "retry") {
    const ok = await retrySyncLog(session.shop, String(form.get("logId") ?? ""));
    return ok ? { ok: true, message: "Queued for retry — runs on the next sync pass." } : { ok: false, error: "That entry wasn’t found." };
  }
  if (intent === "run-export") {
    const summary = await runExportForShop(session.shop, makeConnector);
    return { ok: true, message: `Export run: ${summary.synced} synced, ${summary.failed} failed, ${summary.pending} pending.` };
  }
  if (intent === "simulate-stock") {
    const { applied, errors } = await applyStockUpdate(session.shop, String(form.get("stock") ?? ""));
    return applied > 0 || errors.length === 0
      ? { ok: true, message: `Applied ${applied} stock update(s).${errors.length ? ` ${errors.length} skipped.` : ""}` }
      : { ok: false, error: `No updates applied. ${errors.slice(0, 2).join(" ")}` };
  }
  return { ok: false, error: "Unknown action." };
};

const STATUS_TONE: Record<string, "success" | "attention" | "critical"> = { SYNCED: "success", PENDING: "attention", FAILED: "critical" };
const STATUS_LABELS: Record<string, string> = { SYNCED: "Synced", PENDING: "Pending", FAILED: "Failed" };
const CONNECTION_LABELS: Record<string, string> = { CONNECTED: "Connected", ERROR: "Connection error" };

export default function Erp() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const busy = nav.state === "submitting";
  const busyIntent = busy ? String(nav.formData?.get("intent") ?? "") : "";

  const c = data.connection;
  const [kind, setKind] = useState<string>(c?.kind ?? "WEBHOOK");
  const [endpoint, setEndpoint] = useState(c?.endpoint ?? "");
  const [secret, setSecret] = useState("");
  const [sandbox, setSandbox] = useState(c?.sandbox ?? true);
  const [sourceOfTruth, setSourceOfTruth] = useState<string>(c?.sourceOfTruth ?? "SHOPIFY");
  const [config, setConfig] = useState(c ? JSON.stringify(c.config, null, 2) : "{}");
  const [stock, setStock] = useState("");

  if (!data.isGrowth) {
    return (
      <Page>
        <TitleBar title="ERP sync" />
        <SectionTabs active="erp" />
        <Banner tone="info" title="ERP & inventory sync — upgrade to Growth">
          <p>
            Keep stock accurate and export orders to your ERP/WMS (webhook, SFTP,
            NetSuite, or a custom connector). ERP sync is included on the Growth plan.
          </p>
          <Box paddingBlockStart="200">
            <Button url={upgradeUrl("growth")} variant="primary">See Growth</Button>
          </Box>
          <Box paddingBlockStart="200">
            <Text as="p" tone="subdued" variant="bodySm">
              Need enterprise-scale sync (bi-directional NetSuite, high volume)? Email{" "}
              <PolarisLink url={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Enterprise ERP sync")}`} target="_blank">
                {SUPPORT_EMAIL}
              </PolarisLink>{" "}
              and tell us what you need.
            </Text>
          </Box>
        </Banner>
      </Page>
    );
  }

  const runExport = () => {
    const fd = new FormData();
    fd.set("intent", "run-export");
    submit(fd, { method: "post" });
  };

  const syncLog = (
    <Card padding="0" key="log">
      <Box padding="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Sync log</Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Inbound stock updates the oversell guard; paid and approved orders export automatically. A sync
            failure never blocks a Shopify order — it shows here so you can retry it.
          </Text>
        </BlockStack>
      </Box>
      {data.logs.length === 0 ? (
        <EmptyState
          heading="Nothing synced yet"
          action={c ? { content: "Run export now", onAction: runExport, loading: busyIntent === "run-export" } : undefined}
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>
            {c
              ? "Orders queue for export once they're paid or approved. Run the queue now, or let the scheduler do it."
              : "Connect your ERP below. Stock updates and order exports will appear here."}
          </p>
        </EmptyState>
      ) : (
        <IndexTable resourceName={{ singular: "sync", plural: "syncs" }} itemCount={data.logs.length} selectable={false} headings={[{ title: "Direction" }, { title: "Entity" }, { title: "Status" }, { title: "Detail" }, { title: "Actions", hidden: true }]}>
          {data.logs.map((l, i) => (
            <IndexTable.Row id={l.id} key={l.id} position={i}>
              <IndexTable.Cell>{l.direction === "INBOUND_STOCK" ? "Inbound stock" : "Outbound order"}</IndexTable.Cell>
              <IndexTable.Cell>{l.entity}</IndexTable.Cell>
              <IndexTable.Cell><Badge tone={STATUS_TONE[l.status] ?? "attention"}>{STATUS_LABELS[l.status] ?? l.status}</Badge></IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" tone={l.status === "FAILED" ? "critical" : "subdued"} variant="bodySm">
                  {l.error ?? (l.remoteId ? `→ ${l.remoteId}` : l.status === "SYNCED" ? "Synced" : `Attempt ${l.attempts}`)}
                </Text>
              </IndexTable.Cell>
              <IndexTable.Cell>
                {l.status === "FAILED" && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="retry" />
                    <input type="hidden" name="logId" value={l.id} />
                    <Button submit size="micro" accessibilityLabel={`Retry sync for ${l.entity}`} loading={busyIntent === "retry" && nav.formData?.get("logId") === l.id}>Retry</Button>
                  </Form>
                )}
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      )}
    </Card>
  );

  const connection = (
    <Card key="connection">
      <BlockStack gap="300">
        <Form method="post">
          <input type="hidden" name="intent" value="save" />
          <BlockStack gap="300">
            <BlockStack gap="100">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Connection</Text>
                {c ? (
                  <Badge tone={c.status === "CONNECTED" ? "success" : "critical"}>
                    {`${CONNECTION_LABELS[c.status] ?? c.status}${c.sandbox ? " · Sandbox" : ""}`}
                  </Badge>
                ) : (
                  <Badge>Not connected</Badge>
                )}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                {c ? `${erpKindName(c.kind as ErpKind)} · ` : ""}Credentials are stored encrypted and never logged.
              </Text>
            </BlockStack>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
              <Select label="Connection type" name="kind" options={data.kinds.map((k) => ({ label: k.name, value: k.id }))} value={kind} onChange={setKind} />
              <Select label="Source of truth for stock" name="sourceOfTruth" options={[{ label: "Shopify", value: "SHOPIFY" }, { label: "ERP", value: "ERP" }]} value={sourceOfTruth} onChange={setSourceOfTruth} />
              <TextField label="Endpoint (webhook URL or SFTP host)" name="endpoint" value={endpoint} onChange={setEndpoint} autoComplete="off" placeholder="https://erp.example.com/hooks/mannon" />
              <TextField label="Secret or credentials" name="secret" type="password" value={secret} onChange={setSecret} autoComplete="off" helpText={c?.hasSecret ? "A secret is stored (encrypted). Leave blank to keep it." : "Stored encrypted; used as the bearer token and inbound secret."} />
            </InlineGrid>
            <TextField label="Field mapping (JSON)" name="config" value={config} onChange={setConfig} multiline={3} autoComplete="off" helpText="Optional. Leave as {} to use the default mapping." />
            <Checkbox label="Sandbox (dry run) mode" name="sandbox" checked={sandbox} onChange={setSandbox} helpText="Exports are logged but not sent to your ERP." />
            <InlineStack>
              <Button variant="primary" submit loading={busyIntent === "save"}>Save connection</Button>
            </InlineStack>
          </BlockStack>
        </Form>
        {/* Outside the Save form: a nested <form> is invalid HTML and broke Disconnect. */}
        {c && (
          <InlineStack>
            <ConfirmAction
              label="Disconnect"
              variant="tertiary"
              title="Disconnect your ERP?"
              message="Stock updates and order exports stop until you connect again. Your sync log is kept."
              confirmLabel="Disconnect ERP"
              fields={{ intent: "disconnect" }}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );

  return (
    <Page
      primaryAction={
        c ? { content: "Run export now", onAction: runExport, loading: busyIntent === "run-export" } : undefined
      }
    >
      <TitleBar title="ERP sync" />
      <SectionTabs active="erp" />
      <BlockStack gap="500">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}
        {data.lagging && (
          <Banner tone="warning" title="Sync lag detected">
            <p>No successful sync in over 2 hours. Check your ERP connection.</p>
          </Banner>
        )}

        {/* Connected: status + log first. Not connected yet: the connection form is the job. */}
        {c ? [syncLog, connection] : [connection, syncLog]}

        {c && (
          <DisclosureCard
            title="Inbound stock (test tool)"
            subtitle="For testing only: paste stock levels to check how an inbound update from your ERP is applied."
            badge={<Badge>Test</Badge>}
          >
            <Form method="post">
              <input type="hidden" name="intent" value="simulate-stock" />
              <BlockStack gap="300">
                <TextField
                  label="Stock levels (variant ID, quantity — one per line)"
                  name="stock"
                  value={stock}
                  onChange={setStock}
                  multiline={3}
                  autoComplete="off"
                  placeholder={"gid://shopify/ProductVariant/1,0\ngid://shopify/ProductVariant/2,24"}
                />
                <InlineStack><Button submit loading={busyIntent === "simulate-stock"}>Apply stock update</Button></InlineStack>
              </BlockStack>
            </Form>
          </DisclosureCard>
        )}
      </BlockStack>
    </Page>
  );
}
