import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Select, DropZone, IndexTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { bulkImportAllowed, bulkImportRowCap, GROWTH_PLAN } from "../lib/billing";
import { previewImport, commitImport, ImportHasErrorsError } from "../services/quote-import.server";
import type { ImportMode } from "../lib/quote-import";

const IS_TEST = process.env.NODE_ENV !== "production";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const status = await requireBilling(billing, { isTest: IS_TEST });
  return { plan: status.plan, allowed: bulkImportAllowed(status.plan), cap: bulkImportRowCap(status.plan) };
};

type ActionResult =
  | { ok: true; kind: "preview"; preview: Awaited<ReturnType<typeof previewImport>> }
  | { ok: true; kind: "commit"; message: string }
  | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  const status = await requireBilling(billing, { isTest: IS_TEST });
  if (!bulkImportAllowed(status.plan)) return { ok: false, error: "Bulk import is a Growth feature." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const mode = (String(form.get("mode") ?? "quotes") as ImportMode);
  const csv = String(form.get("csv") ?? "");
  const targetQuoteId = String(form.get("targetQuoteId") ?? "").trim() || null;
  const opts = { plan: status.plan, targetQuoteId };

  if (intent === "preview") {
    return { ok: true as const, kind: "preview" as const, preview: await previewImport(session.shop, csv, mode, opts) };
  }
  if (intent === "commit") {
    try {
      const res = await commitImport(session.shop, csv, mode, opts);
      const parts = [res.createdQuotes ? `${res.createdQuotes} quote(s) created` : null, res.addedLines ? `${res.addedLines} line(s) added` : null].filter(Boolean);
      return { ok: true as const, kind: "commit" as const, message: parts.join(", ") || "Nothing to import." };
    } catch (error) {
      if (error instanceof ImportHasErrorsError) return { ok: false as const, error: error.message };
      throw error;
    }
  }
  return { ok: false as const, error: "Unknown action." };
};

const SAMPLE: Record<ImportMode, string> = {
  quotes: "quote,email,sku,quantity,price\nA,buyer@acme.com,MUG-12,24,\nA,buyer@acme.com,LID-12,24,4.50\nB,buyer2@acme.com,MUG-12,12,",
  lines: "sku,quantity,price\nMUG-12,24,\nLID-12,24,4.50",
};

export default function QuoteImport() {
  const { allowed, cap } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const busy = nav.state === "submitting";

  const [mode, setMode] = useState<ImportMode>("quotes");
  const [csv, setCsv] = useState("");
  const [targetQuoteId, setTargetQuoteId] = useState("");

  const run = (intent: "preview" | "commit") => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("mode", mode);
    fd.set("csv", csv);
    fd.set("targetQuoteId", targetQuoteId);
    submit(fd, { method: "post" });
  };

  const preview = actionData?.ok && actionData.kind === "preview" ? actionData.preview : null;
  const committed = actionData?.ok && actionData.kind === "commit" ? actionData.message : null;
  const errorMsg = actionData && !actionData.ok ? actionData.error : null;

  const onDrop = (_files: File[], accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  if (!allowed) {
    return (
      <Page backAction={{ url: "/app/quotes" }}>
        <TitleBar title="Bulk import" />
        <Banner tone="info" title="Bulk import is a Growth feature">
          <p>Upload a CSV to add many products to a quote, or create many quotes at once.</p>
          <Box paddingBlockStart="200"><Button url={`/app/settings?upgrade=${GROWTH_PLAN}`} variant="primary">See Growth</Button></Box>
        </Banner>
      </Page>
    );
  }

  return (
    <Page backAction={{ url: "/app/quotes" }}>
      <TitleBar title="Bulk import" />
      <BlockStack gap="400">
          {committed && <Banner tone="success" title="Imported">{committed}</Banner>}
          {errorMsg && <Banner tone="critical">{errorMsg}</Banner>}

          <Card>
            <BlockStack gap="300">
              <Select
                label="What do you want to do"
                options={[{ label: "Create many quotes", value: "quotes" }, { label: "Add products to one quote", value: "lines" }]}
                value={mode}
                onChange={(v) => setMode(v as ImportMode)}
              />
              {mode === "lines" && (
                <TextField label="Target quote ID" value={targetQuoteId} onChange={setTargetQuoteId} autoComplete="off" helpText="The quote to add these lines to (must be editable)." />
              )}
              <DropZone accept=".csv,text/csv" type="file" onDrop={onDrop} allowMultiple={false}>
                <DropZone.FileUpload actionTitle="Upload CSV" actionHint="or drag and drop a .csv file" />
              </DropZone>
              <TextField
                label="CSV"
                value={csv}
                onChange={setCsv}
                autoComplete="off"
                multiline={6}
                placeholder={SAMPLE[mode]}
                helpText={`Columns: ${mode === "quotes" ? "quote, email, sku, quantity, price (price optional)" : "sku, quantity, price (price optional)"}. Up to ${cap} rows. Nothing is saved until you commit, and a batch with any error is rejected whole.`}
              />
              <InlineStack gap="200">
                <Button onClick={() => run("preview")} disabled={busy || !csv.trim()}>Preview</Button>
                <Button onClick={() => run("commit")} variant="primary" disabled={busy || !preview?.ok}>Import{preview?.ok ? ` (${preview.rows.length})` : ""}</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          {preview && (
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Preview</Text>
                  <Badge tone={preview.ok ? "success" : "critical"}>{preview.ok ? "Ready to import" : `${preview.errors.length} issue(s)`}</Badge>
                  {mode === "quotes" && <Text as="span" tone="subdued" variant="bodySm">{preview.quoteCount} quote(s)</Text>}
                </InlineStack>
                {preview.errors.filter((e) => e.line === 0).map((e, i) => (
                  <Banner key={i} tone="critical">{e.message}</Banner>
                ))}
                {preview.rows.length > 0 && (
                  <IndexTable
                    resourceName={{ singular: "row", plural: "rows" }}
                    itemCount={preview.rows.length}
                    selectable={false}
                    headings={[{ title: "Row" }, ...(mode === "quotes" ? [{ title: "Quote" }, { title: "Buyer" }] : []), { title: "Item" }, { title: "Qty" }, { title: "Price" }, { title: "Status" }]}
                  >
                    {preview.rows.map((r, i) => (
                      <IndexTable.Row id={String(r.line)} key={r.line} position={i}>
                        <IndexTable.Cell>{r.line}</IndexTable.Cell>
                        {mode === "quotes" && <IndexTable.Cell>{r.group}</IndexTable.Cell>}
                        {mode === "quotes" && <IndexTable.Cell>{r.email}</IndexTable.Cell>}
                        <IndexTable.Cell>{r.title ?? r.sku}</IndexTable.Cell>
                        <IndexTable.Cell>{r.quantity}</IndexTable.Cell>
                        <IndexTable.Cell>{r.price == null ? "—" : r.price.toFixed(2)}</IndexTable.Cell>
                        <IndexTable.Cell>{r.ok ? <Badge tone="success">OK</Badge> : <Text as="span" tone="critical">{r.issue}</Text>}</IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}
              </BlockStack>
            </Card>
          )}
      </BlockStack>
    </Page>
  );
}
