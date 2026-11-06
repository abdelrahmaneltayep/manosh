import { useState } from "react";
import { storefrontBlockLinks } from "../lib/theme-deep-links";
import { StorefrontSetupCard } from "../components/StorefrontSetupCard";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
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
  Divider,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import { requireBilling } from "../services/billing.server";
import { quoteWidgetFeatures, GROWTH_PLAN } from "../lib/billing";
import {
  getWidgetConfig,
  saveWidgetConfig,
  listQuoteRequests,
  convertToQuote,
  declineRequest,
  replyToRequest,
} from "../services/quote-widget.server";
import prisma from "../db.server";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  CLAUDE_UNAVAILABLE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draftRequestReply } from "../services/quote-request-ai.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { upgradeUrl } from "../lib/upgrade";
import { DisclosureCard } from "../components/DisclosureCard";
import { ConfirmAction } from "../components/ConfirmAction";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_QUOTE_WIDGET === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const [config, requests] = await Promise.all([getWidgetConfig(session.shop), listQuoteRequests(session.shop)]);
  const shopRow = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shopRow ?? { plan: "FREE" }, new Date());
  const themeLinks = storefrontBlockLinks(session.shop, process.env.SHOPIFY_API_KEY, ["quote_button", "add_to_quote", "cart_to_quote"]);
  return { isGrowth: status.plan === GROWTH_PLAN, features: quoteWidgetFeatures(status.plan), config, requests, access, themeLinks };
};

type ActionResult =
  | { ok: true; message?: string; draft?: { requestId: string; message: string } }
  | { ok: false; error: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs): Promise<Response | ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  await requireBilling(billing, { isTest: IS_TEST });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // --- F17 dual-mode: Claude drafts an acknowledgement reply; merchant sends ---
  if (intent === "ai-reply-draft") {
    const { access } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, upgrade: true, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    try {
      const drafted = await draftRequestReply(session.shop, String(form.get("id") ?? ""));
      if (!drafted) return { ok: false, error: "That request is no longer available." };
      return { ok: true, draft: drafted };
    } catch {
      return { ok: false, error: CLAUDE_UNAVAILABLE_COPY };
    }
  }
  if (intent === "reply") {
    const body = String(form.get("message") ?? "");
    const ok = await replyToRequest(session.shop, String(form.get("id") ?? ""), body);
    return ok ? { ok: true, message: "Reply sent to the requester." } : { ok: false, error: "Couldn’t send that reply." };
  }

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

function RequestReplyRow({
  r,
  access,
  divider,
}: {
  r: { id: string; email: string; companyName: string | null };
  access: ClaudeAccess;
  divider: boolean;
}) {
  const draftFetcher = useFetcher<typeof action>();
  const drafting = draftFetcher.state !== "idle";
  const [message, setMessage] = useState("");
  const d = draftFetcher.data;
  const draft = d && d.ok && d.draft && d.draft.requestId === r.id ? d.draft : null;
  const draftErr = d && !d.ok ? d.error : null;

  return (
    <div>
      {divider && <Divider />}
      <Box paddingBlock="300">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" fontWeight="semibold">{r.email}</Text>
              {r.companyName && <Text as="span" tone="subdued" variant="bodySm">{r.companyName}</Text>}
            </InlineStack>
            {access.allowed && (
              <Button
                size="slim"
                disabled={drafting}
                loading={drafting}
                onClick={() => draftFetcher.submit({ intent: "ai-reply-draft", id: r.id }, { method: "post" })}
              >
                ✦ Draft reply with Claude
              </Button>
            )}
          </InlineStack>

          {draftErr && <Banner tone="warning">{draftErr}</Banner>}
          {draft && (
            <Box background="bg-surface-secondary" borderRadius="200" padding="300">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">{draft.message}</Text>
                <InlineStack gap="200">
                  <Button size="slim" variant="primary" onClick={() => setMessage(draft.message)}>Use this</Button>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Badge tone="info">✦ Drafted by Claude</Badge>
                  <Text as="span" variant="bodySm">{DRAFTED_BY_CLAUDE_TRUST}</Text>
                </InlineStack>
              </BlockStack>
            </Box>
          )}

          <Form method="post">
            <input type="hidden" name="intent" value="reply" />
            <input type="hidden" name="id" value={r.id} />
            <BlockStack gap="200">
              <TextField
                label="Reply to requester"
                labelHidden
                name="message"
                value={message}
                onChange={setMessage}
                multiline={2}
                autoComplete="off"
                placeholder="Draft a reply with Claude above, or write one here."
              />
              <InlineStack>
                <Button size="slim" submit disabled={!message.trim()}>Send reply</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </BlockStack>
      </Box>
    </div>
  );
}

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
  const newRequests = data.requests.filter((r) => r.status === "NEW");
  // Setup opens on first run (no requests yet) or when Home's setup guide sends the merchant here.
  const [params] = useSearchParams();
  const setupOpen = data.requests.length === 0 || params.get("setup") === "1";
  const STATUS_LABEL: Record<string, string> = { NEW: "New", CONVERTED: "Converted", DECLINED: "Declined" };
  const SOURCE_LABEL: Record<string, string> = { PDP: "Product page", WIDGET: "Product page", CART: "Cart", FORM: "Quote form" };

  return (
    <Page>
      <TitleBar title="Requests" />
      <SectionTabs active="requests" />
      <BlockStack gap="400">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        {/* 1 — The inbox: what came in from the storefront, and the next step on each. */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Requests</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Requests from your storefront’s Request a Quote button. Convert one to a quote to price it.
              </Text>
            </BlockStack>
          </Box>
          {data.requests.length === 0 ? (
            <EmptyState
              heading="No requests yet"
              action={{ content: "Add the button to your store", url: "?setup=1" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Requests appear here when a visitor uses the Request a Quote button on your storefront. Add the button below to start.</p>
            </EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: "request", plural: "requests" }} itemCount={data.requests.length} selectable={false} headings={[{ title: "From" }, { title: "Source" }, { title: "Items" }, { title: "Status" }, { title: "Actions" }]}>
              {data.requests.map((r, i) => (
                <IndexTable.Row id={r.id} key={r.id} position={i}>
                  <IndexTable.Cell>
                    {r.email}
                    {r.companyName && <><br /><Text as="span" tone="subdued" variant="bodySm">{r.companyName}</Text></>}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{SOURCE_LABEL[r.source] ?? r.source}</IndexTable.Cell>
                  <IndexTable.Cell>{String(r.itemCount)}{r.note ? " + note" : ""}</IndexTable.Cell>
                  <IndexTable.Cell><Badge tone={STATUS_TONE[r.status] ?? "attention"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></IndexTable.Cell>
                  <IndexTable.Cell>
                    {r.status === "NEW" ? (
                      <InlineStack gap="150">
                        <Form method="post">
                          <input type="hidden" name="intent" value="convert" />
                          <input type="hidden" name="id" value={r.id} />
                          <Button submit size="micro" variant="primary" loading={busy && nav.formData?.get("id") === r.id}>Convert to quote</Button>
                        </Form>
                        <ConfirmAction
                          label="Decline"
                          size="micro"
                          variant="tertiary"
                          title="Decline this request?"
                          message={`${r.email} won’t get a quote for this request. You can still reach them by email.`}
                          confirmLabel="Decline request"
                          fields={{ intent: "decline", id: r.id }}
                        />
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

        {/* 2 — Acknowledge new requests while the quote is being prepared. */}
        {newRequests.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Reply to new requests</Text>
                {data.access.state === "trial" && data.access.daysLeft != null && (
                  <Badge tone="attention">{`Claude trial · ${data.access.daysLeft} ${data.access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
                )}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Let the buyer know you’re on it while you prepare the quote. Write the reply, or draft it with Claude and review it first.
              </Text>
              {!data.access.allowed && <UpgradeToClaude access={data.access as ClaudeAccess} upgradeUrl={upgradeUrl("growth")} />}
              <BlockStack gap="0">
                {newRequests.map((r, i) => (
                  <RequestReplyRow key={r.id} r={r} access={data.access as ClaudeAccess} divider={i > 0} />
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* 3 — Set up once: the storefront button and where it shows. */}
        <DisclosureCard
          title="Storefront button"
          subtitle={`${enabled ? "On" : "Off"} · “${label || "Request a Quote"}”. Button settings and adding it to your theme.`}
          defaultOpen={setupOpen}
          showLabel="Edit"
          hideLabel="Close"
        >
          <BlockStack gap="400">
            <Form method="post">
              <input type="hidden" name="intent" value="save" />
              <BlockStack gap="300">
                <InlineStack gap="400" blockAlign="center" wrap>
                  <input type="hidden" name="enabled" value={enabled ? "on" : ""} />
                  <Checkbox label="Show the Request a Quote button" checked={enabled} onChange={setEnabled} />
                  <Box minWidth="260px"><TextField label="Button label" name="label" value={label} onChange={setLabel} autoComplete="off" placeholder="Request a Quote" /></Box>
                </InlineStack>
                <InlineStack gap="400" blockAlign="center" wrap>
                  <input type="hidden" name="gated" value={gated ? "on" : ""} />
                  <Checkbox label="Only show it to approved wholesale buyers" checked={gated} onChange={setGated} disabled={!data.features.gatedMode} helpText={data.features.gatedMode ? undefined : "Available on Growth"} />
                  <input type="hidden" name="cartEnabled" value={cartEnabled ? "on" : ""} />
                  <Checkbox label="Allow requests from the cart" checked={cartEnabled} onChange={setCartEnabled} disabled={!data.features.cartLevel} helpText={data.features.cartLevel ? undefined : "Available on Growth"} />
                </InlineStack>
                {data.features.customFields ? (
                  <TextField label="Extra form fields" helpText="One per line, as key=Label (for example po_number=PO number)." name="customFields" value={fields} onChange={setFields} multiline={2} autoComplete="off" placeholder={"po_number=PO number\nrequired_by=Required by"} />
                ) : (
                  <input type="hidden" name="customFields" value="" />
                )}
                <InlineStack gap="200" blockAlign="center">
                  <Button variant="primary" submit loading={busy && nav.formData?.get("intent") === "save"}>Save button settings</Button>
                </InlineStack>
              </BlockStack>
            </Form>
            <Divider />
            <Text as="h3" variant="headingSm">Add it to your theme</Text>
            <StorefrontSetupCard bare title="Add quote requests to your storefront" links={data.themeLinks} />
          </BlockStack>
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
