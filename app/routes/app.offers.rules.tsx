import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Select, Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShopCapabilities } from "../services/billing.server";
import { MAKE_AN_OFFER_ENABLED, listRules, createRule, deleteRule, OfferRuleCapError } from "../services/offers.server";

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

  return (
    <Page backAction={{ url: "/app/offers" }}>
      <TitleBar title="Offer rules" />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">How rules decide</Text>
            <Text as="p" tone="subdued" variant="bodyMd">
              The highest-priority matching rule handles an offer: <b>auto-decline</b> below its floor,
              <b> auto-accept</b> at/above its accept threshold, otherwise <b>counter</b>. The <b>margin floor
              always wins</b> — an offer is never accepted or countered below it.{" "}
              {tier === "manual"
                ? <Badge tone="info">Growth · rules guide manual decisions</Badge>
                : <Badge tone="success">Scale · rules auto-execute + PWYW</Badge>}
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Your rules</Text>
              <Text as="span" tone="subdued" variant="bodySm">{used}{Number.isFinite(cap) ? ` / ${cap}` : ""} used</Text>
            </InlineStack>
            {rules.length === 0 ? (
              <Text as="p" tone="subdued" variant="bodyMd">No rules yet — add one below.</Text>
            ) : (
              <BlockStack gap="200">
                {rules.map((r) => (
                  <Box key={r.id} padding="300" borderColor="border" borderWidth="025" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="050">
                        <Text as="span" variant="headingSm">{r.name}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          accept ≥ {Math.round(r.minAcceptPctOfList * 100)}% · decline &lt; {Math.round(r.autoDeclineBelowPctOfList * 100)}%
                          {r.autoCounterToPctOfList != null && ` · counter → ${Math.round(r.autoCounterToPctOfList * 100)}%`} · floor {Math.round(r.marginFloorPct * 100)}% · priority {r.priority}
                        </Text>
                      </BlockStack>
                      <Form method="post"><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={r.id} /><Button submit tone="critical" variant="tertiary" disabled={busy}>Delete</Button></Form>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Add a rule</Text>
            {capReached ? (
              <Banner tone="warning">You've reached your plan's rule limit ({cap}). Upgrade to Scale for unlimited rules + automation.</Banner>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <BlockStack gap="300">
                  <TextField label="Name" name="name" value={f.name} onChange={set("name")} autoComplete="off" placeholder="e.g. Standard offers" />
                  <InlineStack gap="300" wrap>
                    <Box minWidth="11rem"><TextField label="Auto-accept at ≥ (% of list)" name="minAcceptPct" type="number" value={f.minAcceptPct} onChange={set("minAcceptPct")} autoComplete="off" suffix="%" /></Box>
                    <Box minWidth="11rem"><TextField label="Auto-decline below (% of list)" name="autoDeclinePct" type="number" value={f.autoDeclinePct} onChange={set("autoDeclinePct")} autoComplete="off" suffix="%" /></Box>
                    <Box minWidth="11rem"><TextField label="Counter to (% of list, optional)" name="autoCounterToPct" type="number" value={f.autoCounterToPct} onChange={set("autoCounterToPct")} autoComplete="off" suffix="%" /></Box>
                    <Box minWidth="11rem"><TextField label="Margin floor (%)" name="marginFloorPct" type="number" value={f.marginFloorPct} onChange={set("marginFloorPct")} autoComplete="off" suffix="%" helpText="Never accept/counter below this margin" /></Box>
                    <Box minWidth="8rem"><TextField label="Priority" name="priority" type="number" value={f.priority} onChange={set("priority")} autoComplete="off" /></Box>
                  </InlineStack>
                  <Box><Button submit variant="primary" disabled={busy}>Add rule</Button></Box>
                </BlockStack>
              </Form>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
