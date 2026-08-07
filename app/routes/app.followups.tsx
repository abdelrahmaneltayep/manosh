import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
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
  Checkbox,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireBilling } from "../services/billing.server";
import { GROWTH_PLAN } from "../lib/billing";
import { getPolicy, upsertPolicy, needsNudgeList, sendNow } from "../services/followups.server";
import { clampCadence } from "../lib/followups";
import { formatDate } from "../lib/format";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draftFollowupMessage } from "../services/followups-ai.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_FOLLOWUPS === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const policy = await getPolicy(session.shop);
  const nudge = await needsNudgeList(session.shop);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop }, select: { timezone: true, plan: true, legacyPlan: true, claudeTrialStartedAt: true } });
  const access = claudeAccess(shop ?? { plan: "FREE" }, new Date());

  return {
    isGrowth: status.plan === GROWTH_PLAN,
    policy,
    timezone: shop?.timezone ?? "",
    effectiveCadence: clampCadence(policy.cadenceDays, policy.planMax),
    nudge: nudge.map((n) => ({ ...n })),
    access,
  };
};

type ActionResult =
  | { ok: true; message?: string; draft?: { quoteId: string; message: string } }
  | { ok: false; error: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  await requireBilling(billing, { isTest: IS_TEST });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  // --- F8 dual-mode: Claude drafts a reminder body; merchant edits + sends -----
  if (intent === "ai-followup-draft") {
    const { access } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, upgrade: true, error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    const quoteId = String(form.get("quoteId") ?? "");
    const drafted = await draftFollowupMessage(session.shop, quoteId);
    if (!drafted) return { ok: false, error: "That quote is no longer open." };
    return { ok: true, draft: drafted };
  }

  if (intent === "send-now") {
    const customBody = String(form.get("message") ?? "").trim() || undefined;
    const ok = await sendNow(session.shop, String(form.get("quoteId") ?? ""), baseUrl, { customBody });
    return ok ? { ok: true, message: "Reminder sent." } : { ok: false, error: "Couldn’t send that reminder." };
  }

  if (intent === "save-policy") {
    const cadence = String(form.get("cadenceDays") ?? "")
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    const expiryDays = Math.max(1, Math.min(365, Number(form.get("expiryDays")) || 14));
    const maxNudges = Math.max(0, Math.min(10, Number(form.get("maxNudges")) || 3));
    await upsertPolicy(session.shop, {
      enabled: form.get("enabled") === "on",
      expiryDays,
      cadenceDays: cadence.length ? cadence : [3, 7, 12],
      maxNudges,
    });
    const timezone = String(form.get("timezone") ?? "").trim();
    await prisma.shop.update({ where: { shopifyDomain: session.shop }, data: { timezone: timezone || null } });
    return { ok: true, message: "Follow-up policy saved." };
  }
  return { ok: false, error: "Unknown action." };
};

export default function Followups() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const [enabled, setEnabled] = useState(data.policy.enabled);
  const [expiryDays, setExpiryDays] = useState(String(data.policy.expiryDays));
  const [cadence, setCadence] = useState(data.policy.cadenceDays.join(", "));
  const [maxNudges, setMaxNudges] = useState(String(data.policy.maxNudges));
  const [tz, setTz] = useState(data.timezone);

  const err = actionData && !actionData.ok ? actionData.error : null;
  const msg = actionData && actionData.ok ? actionData.message : null;

  return (
    <Page>
      <TitleBar title="Follow-ups" />
      <BlockStack gap="500">
        {err && <Banner tone="critical" title="Couldn’t save"><p>{err}</p></Banner>}
        {msg && <Banner tone="success" title={msg} />}

        {!data.policy.enabled && (
          <Banner tone="info" title="Set your quote expiry policy">
            <p>Turn on follow-ups so open quotes nudge themselves before they expire — the simplest lift to quote-to-order conversion.</p>
          </Banner>
        )}

        {/* Policy */}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save-policy" />
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Store follow-up policy</Text>
              <Checkbox label="Automatically follow up on open quotes" name="enabled" checked={enabled} onChange={setEnabled} />
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                <TextField label="Expire quotes after (days)" type="number" name="expiryDays" value={expiryDays} onChange={setExpiryDays} min={1} max={365} autoComplete="off" />
                <TextField label="Nudge on days after submit" name="cadenceDays" value={cadence} onChange={setCadence} autoComplete="off" helpText="Comma-separated, e.g. 3, 7, 12" disabled={!data.isGrowth} />
                <TextField label="Max nudges" type="number" name="maxNudges" value={maxNudges} onChange={setMaxNudges} min={0} max={10} autoComplete="off" disabled={!data.isGrowth} />
              </InlineGrid>
              <TextField label="Store timezone (IANA)" name="timezone" value={tz} onChange={setTz} autoComplete="off" placeholder="e.g. Asia/Riyadh" helpText="Reminders only send during business hours (Mon–Fri, 9–18) in this timezone." />
              {!data.isGrowth && (
                <Banner tone="warning">
                  <p>Starter sends a <b>single</b> reminder per quote plus the expiry. Upgrade to Growth for a multi-nudge cadence and auto-expiry actions.</p>
                  <Box paddingBlockStart="200"><Button url="/app/settings" variant="primary">Upgrade to Growth</Button></Box>
                </Banner>
              )}
              <Text as="p" tone="subdued" variant="bodySm">
                Effective cadence on your plan: {data.effectiveCadence.length ? data.effectiveCadence.map((d) => `day ${d}`).join(", ") : "expiry only"}.
              </Text>
              <InlineStack><Button variant="primary" submit loading={busy}>Save policy</Button></InlineStack>
            </BlockStack>
          </Form>
        </Card>

        {/* Needs nudge */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Needs a nudge</Text>
            {data.access.state === "trial" && data.access.daysLeft != null && (
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="attention">{`Claude trial · ${data.access.daysLeft} ${data.access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
              </InlineStack>
            )}
            {!data.access.allowed && data.nudge.length > 0 && (
              <UpgradeToClaude access={data.access as ClaudeAccess} upgradeUrl="/app/settings" />
            )}
            {data.nudge.length === 0 ? (
              <Text as="p" tone="subdued">No open quotes waiting on a nudge.</Text>
            ) : (
              <BlockStack gap="0">
                {data.nudge.map((n, i) => (
                  <NudgeRow key={n.id} n={n} access={data.access as ClaudeAccess} divider={i > 0} />
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function NudgeRow({
  n,
  access,
  divider,
}: {
  n: { id: string; companyName: string; expiresAt: string | Date; overdue: boolean };
  access: ClaudeAccess;
  divider: boolean;
}) {
  const draftFetcher = useFetcher<typeof action>();
  const drafting = draftFetcher.state !== "idle";
  const [message, setMessage] = useState("");
  const draftData = draftFetcher.data;
  const draft =
    draftData && draftData.ok && draftData.draft && draftData.draft.quoteId === n.id ? draftData.draft : null;
  const draftErr = draftData && !draftData.ok ? draftData.error : null;

  return (
    <div>
      {divider && <Divider />}
      <Box paddingBlock="300">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Link to={`/app/quotes/${n.id}`}>{n.companyName}</Link>
              {n.overdue && <Badge tone="warning">Due</Badge>}
              <Text as="span" tone="subdued" variant="bodySm">expires {formatDate(n.expiresAt)}</Text>
            </InlineStack>
            {access.allowed && (
              <Button
                size="slim"
                disabled={drafting}
                loading={drafting}
                onClick={() => draftFetcher.submit({ intent: "ai-followup-draft", quoteId: n.id }, { method: "post" })}
              >
                ✦ Draft with Claude
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
            <input type="hidden" name="intent" value="send-now" />
            <input type="hidden" name="quoteId" value={n.id} />
            <BlockStack gap="200">
              <TextField
                label="Reminder message (optional)"
                labelHidden
                name="message"
                value={message}
                onChange={setMessage}
                multiline={2}
                autoComplete="off"
                placeholder="Leave blank to send your default reminder, or draft one with Claude above."
              />
              <InlineStack>
                <Button size="slim" submit>{message.trim() ? "Send this message" : "Send default reminder"}</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </BlockStack>
      </Box>
    </div>
  );
}
