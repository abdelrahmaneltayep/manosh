import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { DisclosureCard } from "../components/DisclosureCard";
import { ConfirmAction } from "../components/ConfirmAction";
import { upgradeUrl } from "../lib/upgrade";
import { authenticate } from "../shopify.server";
import { getShopCapabilities } from "../services/billing.server";
import { MAKE_AN_OFFER_ENABLED, listRules, createRule, deleteRule, OfferRuleCapError } from "../services/offers.server";

const NAME_FIELD_ID = "offer-rule-name";

/** Move focus to the create form's first field (empty-state action). */
function focusField(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.focus();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  if (caps.makeAnOffer === "teaser") throw redirect("/app/offers");
  const rules = await listRules(session.shop);
  return { rules, cap: caps.offerRuleCap, used: rules.length, tier: caps.makeAnOffer };
};

type ActionResult = { ok: boolean; message?: string; error?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  if (caps.makeAnOffer === "teaser") return { ok: false, error: "Upgrade to Growth for offer rules." };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "delete") {
    await deleteRule(session.shop, String(form.get("id") ?? ""));
    return { ok: true, message: "Rule removed." };
  }
  if (intent === "create") {
    const pct = (k: string) => Number(form.get(k) ?? 0) / 100;
    const autoCounter = form.get("autoCounterToPct");
    try {
      const res = await createRule(session.shop, {
        name: String(form.get("name") ?? ""),
        scope: "ALL",
        minAcceptPctOfList: pct("minAcceptPct"),
        autoDeclineBelowPctOfList: pct("autoDeclinePct"),
        autoCounterToPctOfList: autoCounter ? Number(autoCounter) / 100 : null,
        marginFloorPct: pct("marginFloorPct"),
        priority: Number(form.get("priority") ?? 0),
      });
      return "error" in res ? { ok: false, error: res.error } : { ok: true, message: "Rule created." };
    } catch (e) {
      if (e instanceof OfferRuleCapError) return { ok: false, error: `Your plan allows ${e.cap} offer rule${e.cap === 1 ? "" : "s"}. Upgrade to Scale for unlimited.` };
      throw e;
    }
  }
  return { ok: false, error: "Unknown action." };
};

export default function OfferRules() {
  const { rules, cap, used, tier } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const capReached = Number.isFinite(cap) && used >= cap;
  const [f, setF] = useState({ name: "", minAcceptPct: "90", autoDeclinePct: "60", autoCounterToPct: "", marginFloorPct: "25", priority: "0" });
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const firstRun = rules.length === 0;

  return (
    <Page backAction={{ content: "Offers", url: "/app/offers" }} title="Offer rules">
      <TitleBar title="Offer rules" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        {/* 1. The list */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Your rules</Text>
              <Text as="span" tone="subdued" variant="bodySm">{used}{Number.isFinite(cap) ? ` / ${cap}` : ""} used</Text>
            </InlineStack>
            {firstRun ? (
              <BlockStack gap="200">
                <Text as="p" tone="subdued" variant="bodyMd">
                  No rules yet, so you answer every offer yourself with no suggestion. Add a rule to set your accept and decline thresholds.
                </Text>
                {!capReached && (
                  <InlineStack><Button onClick={() => focusField(NAME_FIELD_ID)}>Add a rule</Button></InlineStack>
                )}
              </BlockStack>
            ) : (
              <BlockStack gap="200">
                {rules.map((r) => (
                  <Box key={r.id} padding="300" borderColor="border" borderWidth="025" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingSm">{r.name}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          Accept at {Math.round(r.minAcceptPctOfList * 100)}% or more · decline below {Math.round(r.autoDeclineBelowPctOfList * 100)}%
                          {r.autoCounterToPctOfList != null && ` · counter at ${Math.round(r.autoCounterToPctOfList * 100)}%`} · margin floor {Math.round(r.marginFloorPct * 100)}% · priority {r.priority}
                        </Text>
                      </BlockStack>
                      <ConfirmAction
                        label="Delete"
                        title={`Delete ${r.name}?`}
                        message="New offers will be handled by your other rules, or left for you to answer yourself."
                        confirmLabel="Delete rule"
                        fields={{ intent: "delete", id: r.id }}
                        variant="tertiary"
                        disabled={busy}
                      />
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* 2. Create */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Add a rule</Text>
            {capReached ? (
              <Banner tone="warning" action={{ content: "Upgrade to Scale", url: upgradeUrl("scale") }}>
                <p>You’ve reached your plan’s limit of {cap} {cap === 1 ? "rule" : "rules"}. Scale has unlimited rules and answers offers automatically.</p>
              </Banner>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <BlockStack gap="300">
                  <TextField id={NAME_FIELD_ID} label="Name" name="name" value={f.name} onChange={set("name")} autoComplete="off" placeholder="e.g. Standard offers" />
                  <InlineStack gap="300" wrap>
                    <Box minWidth="11rem"><TextField label="Accept at or above (% of list)" name="minAcceptPct" type="number" value={f.minAcceptPct} onChange={set("minAcceptPct")} autoComplete="off" suffix="%" /></Box>
                    <Box minWidth="11rem"><TextField label="Decline below (% of list)" name="autoDeclinePct" type="number" value={f.autoDeclinePct} onChange={set("autoDeclinePct")} autoComplete="off" suffix="%" /></Box>
                    <Box minWidth="11rem"><TextField label="Counter at (% of list, optional)" name="autoCounterToPct" type="number" value={f.autoCounterToPct} onChange={set("autoCounterToPct")} autoComplete="off" suffix="%" /></Box>
                    <Box minWidth="11rem"><TextField label="Margin floor (%)" name="marginFloorPct" type="number" value={f.marginFloorPct} onChange={set("marginFloorPct")} autoComplete="off" suffix="%" helpText="Never accept or counter below this margin" /></Box>
                    <Box minWidth="8rem"><TextField label="Priority" name="priority" type="number" value={f.priority} onChange={set("priority")} autoComplete="off" helpText="Higher wins" /></Box>
                  </InlineStack>
                  <Box><Button submit variant="primary" disabled={busy}>Add rule</Button></Box>
                </BlockStack>
              </Form>
            )}
          </BlockStack>
        </Card>

        {/* 3. Explanation, one click away (open on first run) */}
        <DisclosureCard
          title="How rules decide"
          subtitle="The highest-priority matching rule handles each offer."
          badge={tier === "manual"
            ? <Badge tone="info">Growth · rules guide your answers</Badge>
            : <Badge tone="success">Scale · rules answer automatically</Badge>}
          defaultOpen={firstRun}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              Below the decline threshold, the rule says decline. At or above the accept threshold, it
              says accept. Anything in between gets a counter.
            </Text>
            <Text as="p" variant="bodyMd">
              The margin floor always wins: an offer is never accepted or countered below it.
              {tier === "manual" ? " On Growth, rules suggest an answer and you confirm it on the offer." : " On Scale, rules answer offers for you."}
            </Text>
          </BlockStack>
        </DisclosureCard>
      </BlockStack>
    </Page>
  );
}
