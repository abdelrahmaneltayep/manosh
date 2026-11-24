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
import { SectionTabs } from "../components/SectionTabs";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireBilling } from "../services/billing.server";
import { isGrowthTier } from "../lib/billing";
import { getPolicy, upsertPolicy, needsNudgeList, sendNow, copyReminder } from "../services/followups.server";
import { clampCadence } from "../lib/followups";
import { formatDate } from "../lib/format";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  CLAUDE_UNAVAILABLE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draftFollowupMessage } from "../services/followups-ai.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { upgradeUrl } from "../lib/upgrade";
import { DisclosureCard } from "../components/DisclosureCard";
import { emailDeliveryEnabled } from "../services/mailer.server";
import { EMAIL_OFF_NOTICE, emailCopy, type EmailCopy } from "../lib/email-delivery";
import { useEmailDelivery } from "../lib/use-email-delivery";
import { CopyPanel } from "../components/CopyPanel";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_FOLLOWUPS === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const policy = await getPolicy(session.shop);
  const nudge = await needsNudgeList(session.shop);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop }, select: { timezone: true, plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true } });
  const access = claudeAccess(shop ?? { plan: "FREE" }, new Date());

  return {
    // Growth and Scale both include the full cadence (Scale ⊃ Growth).
    isGrowth: isGrowthTier(status.plan),
    policy,
    timezone: shop?.timezone ?? "",
    effectiveCadence: clampCadence(policy.cadenceDays, policy.planMax),
    nudge: nudge.map((n) => ({ ...n })),
    access,
  };
};

type ActionResult =
  | { ok: true; message?: string; draft?: { quoteId: string; message: string }; copy?: { quoteId: string; to: string; text: string } }
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
    try {
      const drafted = await draftFollowupMessage(session.shop, quoteId);
      if (!drafted) return { ok: false, error: "That quote is no longer open." };
      return { ok: true, draft: drafted };
    } catch {
      return { ok: false, error: CLAUDE_UNAVAILABLE_COPY };
    }
  }

  if (intent === "send-now") {
    const customBody = String(form.get("message") ?? "").trim() || undefined;
    const quoteId = String(form.get("quoteId") ?? "");
    // No sender connected: hand the merchant the reminder to send themselves.
    if (!emailDeliveryEnabled()) {
      const reminder = await copyReminder(session.shop, quoteId, baseUrl, { customBody });
      return reminder
        ? { ok: true, message: "", copy: { quoteId, to: reminder.to, text: reminder.body } }
        : { ok: false, error: "That quote is no longer open." };
    }
    const ok = await sendNow(session.shop, quoteId, baseUrl, { customBody });
    return ok ? { ok: true, message: emailCopy(true).reminderDone } : { ok: false, error: "Couldn’t send that reminder." };
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
  const copied = (actionData && actionData.ok ? actionData.copy : null) ?? null;
  const emailDelivery = useEmailDelivery();
  const copy = emailCopy(emailDelivery);

  return (
    <Page>
      <TitleBar title="Follow-ups" />
      <SectionTabs active="followups" />
      <BlockStack gap="500">
        {err && <Banner tone="critical" title="Something went wrong"><p>{err}</p></Banner>}
        {msg && <Banner tone="success" title={msg} />}
        {copied && (
          <CopyPanel
            title="Reminder ready"
            description={`Paste this into a message to ${copied.to}. The link signs them in and opens the quote; it works once and replaces any earlier link you made for this buyer.`}
            text={copied.text}
            toast="Reminder copied"
            copyLabel="Copy reminder"
          />
        )}
        {!emailDelivery && (
          <Banner tone="info" title="Reminders aren’t delivered automatically yet">
            <p>{EMAIL_OFF_NOTICE} Quotes that are due stay in the list below until you copy their reminder.</p>
          </Banner>
        )}

        {/* 1 — The job: open quotes that need a reminder now. */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Needs a nudge</Text>
            {data.access.state === "trial" && data.access.daysLeft != null && (
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="attention">{`Claude trial · ${data.access.daysLeft} ${data.access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
              </InlineStack>
            )}
            {!data.access.allowed && data.nudge.length > 0 && (
              <UpgradeToClaude access={data.access as ClaudeAccess} upgradeUrl={upgradeUrl("growth")} />
            )}
            {data.nudge.length === 0 ? (
              <Text as="p" tone="subdued">No open quotes need a reminder right now. Quotes show up here when they’re due a nudge.</Text>
            ) : (
              <BlockStack gap="0">
                {data.nudge.map((n, i) => (
                  <NudgeRow key={n.id} n={n} access={data.access as ClaudeAccess} divider={i > 0} copy={copy} />
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
        {/* 2 — The rule that keeps quotes moving: set once, adjust rarely. */}
        <DisclosureCard
          title="Follow-up policy"
          subtitle={
            data.policy.enabled
              ? `On · ${data.effectiveCadence.length ? data.effectiveCadence.map((d) => `day ${d}`).join(", ") : "expiry reminder only"} · quotes expire after ${data.policy.expiryDays} days`
              : emailDelivery
                ? "Off. Turn it on so open quotes get a reminder before they expire."
                : "Off. Turn it on so open quotes are flagged here when a reminder is due."
          }
          defaultOpen={!data.policy.enabled}
          showLabel="Edit"
          hideLabel="Close"
        >
          <Form method="post">
            <input type="hidden" name="intent" value="save-policy" />
            <BlockStack gap="300">
              <Checkbox
                label={emailDelivery ? "Automatically follow up on open quotes" : "Flag open quotes when a reminder is due"}
                helpText={emailDelivery ? undefined : "Quotes still expire on schedule. Reminders wait in “Needs a nudge” for you to copy."}
                name="enabled"
                checked={enabled}
                onChange={setEnabled}
              />
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                <TextField label="Expire quotes after (days)" type="number" name="expiryDays" value={expiryDays} onChange={setExpiryDays} min={1} max={365} autoComplete="off" />
                <TextField label="Nudge on days after submit" name="cadenceDays" value={cadence} onChange={setCadence} autoComplete="off" helpText="Comma-separated, e.g. 3, 7, 12" disabled={!data.isGrowth} />
                <TextField label="Max nudges" type="number" name="maxNudges" value={maxNudges} onChange={setMaxNudges} min={0} max={10} autoComplete="off" disabled={!data.isGrowth} />
              </InlineGrid>
              <TextField label="Store time zone" name="timezone" value={tz} onChange={setTz} autoComplete="off" placeholder="e.g. Asia/Riyadh" helpText={emailDelivery
                  ? "Reminders only go out during business hours (Mon–Fri, 9–18) in this time zone. Use a name like Asia/Riyadh or America/New_York."
                  : "Used to work out business hours (Mon–Fri, 9–18). Use a name like Asia/Riyadh or America/New_York."} />
              {!data.isGrowth && (
                <Banner tone="warning">
                  <p>Starter includes a <b>single</b> reminder per quote plus the expiry. Upgrade to Growth for a multi-nudge cadence and auto-expiry actions.</p>
                  <Box paddingBlockStart="200"><Button url={upgradeUrl("growth")} variant="primary">Upgrade to Growth</Button></Box>
                </Banner>
              )}
              <Text as="p" tone="subdued" variant="bodySm">
                Effective cadence on your plan: {data.effectiveCadence.length ? data.effectiveCadence.map((d) => `day ${d}`).join(", ") : "expiry only"}.
              </Text>
              <InlineStack><Button variant="primary" submit loading={busy}>Save policy</Button></InlineStack>
            </BlockStack>
          </Form>
        </DisclosureCard>

      </BlockStack>
    </Page>
  );
}

function NudgeRow({
  n,
  access,
  divider,
  copy,
}: {
  n: { id: string; companyName: string; expiresAt: string | Date; overdue: boolean };
  access: ClaudeAccess;
  divider: boolean;
  copy: EmailCopy;
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
                placeholder={copy.reminderPlaceholder}
              />
              <InlineStack>
                <Button size="slim" submit accessibilityLabel={`${copy.reminderAction(Boolean(message.trim()))} for ${n.companyName}`}>{copy.reminderAction(Boolean(message.trim()))}</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </BlockStack>
      </Box>
    </div>
  );
}
