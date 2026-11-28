import { useEffect, useState } from "react";
import { storeSender } from "../services/store-sender.server";
import { shopNameFor } from "../services/shop-name.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Modal } from "@shopify/polaris";
import { TitleBar, SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getEmailTemplates, saveEmailTemplates } from "../services/settings.server";
import { DEFAULT_TEMPLATES, resolveTemplate, sendEmail, emailDeliveryEnabled, type TemplateKey } from "../services/mailer.server";
import { merchantAlertAddresses } from "../services/merchant-alerts.server";
import { checkTemplate, placeholders, renderPreview, sampleValues, templateProblem } from "../lib/template-check";
import { TEMPLATE_INFO, mergeTemplateOverride } from "../lib/notification-templates";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  CLAUDE_UNAVAILABLE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draft } from "../services/claude.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { upgradeUrl } from "../lib/upgrade";
import { emailCopy } from "../lib/email-delivery";
import { useEmailDelivery } from "../lib/use-email-delivery";

const SAVE_BAR_ID = "notification-template-save-bar";

function templateKey(raw: string | undefined): TemplateKey {
  if (!raw || !(raw in DEFAULT_TEMPLATES)) throw new Response("Not found", { status: 404 });
  return raw as TemplateKey;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const key = templateKey(params.key);
  const overrides = await getEmailTemplates(session.shop);
  const current = resolveTemplate(key, overrides);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  return {
    key,
    label: TEMPLATE_INFO[key]?.label ?? key,
    to: TEMPLATE_INFO[key]?.to ?? "Buyer",
    subject: current.subject,
    body: current.body,
    edited: Boolean(overrides?.[key]),
    variables: placeholders(DEFAULT_TEMPLATES[key]),
    defaults: DEFAULT_TEMPLATES[key],
    testTo: (await merchantAlertAddresses(session.shop))[0] ?? null,
    access: claudeAccess(shop ?? { plan: "FREE" }, new Date()),
  };
};

type ActionResult =
  | { ok: true; kind: "saved" | "reset" | "test"; message: string }
  | { ok: true; kind: "draft"; subject: string; body: string }
  | { ok: false; kind: "save" | "draft" | "test"; error: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const key = templateKey(params.key);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  // Dual-mode: Claude drafts new wording; the merchant reviews it and saves.
  if (intent === "ai-template") {
    const { access, shop } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return { ok: false, kind: "draft", error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY };
    }
    try {
      const { output } = await draft({
        feature: "email_template",
        shopId: shop.id,
        input: {
          label: TEMPLATE_INFO[key]?.label ?? key,
          currentSubject: String(form.get("currentSubject") ?? ""),
          currentBody: String(form.get("currentBody") ?? ""),
        },
      });
      return {
        ok: true,
        kind: "draft",
        subject: typeof output.subject === "string" ? output.subject.trim() : "",
        body: typeof output.body === "string" ? output.body.trim() : "",
      };
    } catch {
      return { ok: false, kind: "draft", error: CLAUDE_UNAVAILABLE_COPY };
    }
  }

  const existing = (await getEmailTemplates(session.shop)) ?? {};
  if (intent === "reset") {
    await saveEmailTemplates(session.shop, mergeTemplateOverride(existing, key, null, DEFAULT_TEMPLATES[key]));
    return { ok: true, kind: "reset", message: "Back to Mannon’s default wording." };
  }
  const subject = String(form.get("subject") ?? "");
  const body = String(form.get("body") ?? "");
  if (!subject.trim() || !body.trim()) return { ok: false, kind: "save", error: "Add a subject and a message, or reset to the default." };
  // The same checks the editor shows: the link stays, and every placeholder is one Mannon fills.
  const problem = templateProblem(checkTemplate(DEFAULT_TEMPLATES[key], { subject, body }));

  // Send the wording as it stands (saved or not), filled with sample data, to the merchant.
  if (intent === "test") {
    if (problem) return { ok: false, kind: "test", error: problem };
    if (!emailDeliveryEnabled()) return { ok: false, kind: "test", error: "Mannon isn’t connected to a sender yet, so a test can’t go out." };
    const to = (await merchantAlertAddresses(session.shop))[0];
    if (!to) return { ok: false, kind: "test", error: "Add an alert address in Notifications first: tests go there." };
    const shopRow = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop }, select: { id: true } });
    const preview = renderPreview({ subject, body }, sampleValues(placeholders(DEFAULT_TEMPLATES[key])));
    const sent = await sendEmail(
      { ...(await storeSender(session.shop)), to, subject: `[Test] ${preview.subject}`, html: preview.body.replace(/\n/g, "<br>"), text: preview.body, tag: "template_test" },
      shopRow ? { shopId: shopRow.id, template: key, entityType: "TemplateTest", entityId: key } : undefined,
    );
    return sent.sent
      ? { ok: true, kind: "test", message: `Test sent to ${to}.` }
      : { ok: false, kind: "test", error: `The test wasn’t delivered${sent.error ? `: ${sent.error}` : "."}` };
  }

  if (problem) return { ok: false, kind: "save", error: problem };
  await saveEmailTemplates(session.shop, mergeTemplateOverride(existing, key, { subject, body }, DEFAULT_TEMPLATES[key]));
  return { ok: true, kind: "saved", message: "Email saved." };
};

export default function NotificationTemplate() {
  const data = useLoaderData<typeof loader>();
  const emailDelivery = useEmailDelivery();
  const copy = emailCopy(emailDelivery);
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const busy = nav.state !== "idle";
  const ai = useFetcher<typeof action>();
  const access = data.access as ClaudeAccess;

  const [subject, setSubject] = useState(data.subject);
  const [body, setBody] = useState(data.body);
  const [confirmReset, setConfirmReset] = useState(false);
  // After a save/reset the loader revalidates: adopt the stored wording.
  useEffect(() => {
    setSubject(data.subject);
    setBody(data.body);
  }, [data.subject, data.body]);

  const dirty = subject !== data.subject || body !== data.body;
  useEffect(() => {
    if (dirty) shopify.saveBar.show(SAVE_BAR_ID);
    else shopify.saveBar.hide(SAVE_BAR_ID);
  }, [dirty, shopify]);

  const save = () => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("subject", subject);
    fd.set("body", body);
    submit(fd, { method: "post" });
  };
  const discard = () => {
    setSubject(data.subject);
    setBody(data.body);
  };

  const drafted = ai.data && ai.data.ok && ai.data.kind === "draft" ? ai.data : null;
  const aiError = ai.data && !ai.data.ok ? ai.data.error : null;
  const saveError = result && !result.ok && result.kind === "save" ? result.error : null;
  const saved = result && result.ok && (result.kind === "saved" || result.kind === "reset") ? result.message : null;
  const testResult = result && result.kind === "test" ? result : null;
  const problem = templateProblem(checkTemplate(data.defaults, { subject, body }));
  const preview = renderPreview({ subject, body }, sampleValues(data.variables));
  const sendTest = () => {
    const fd = new FormData();
    fd.set("intent", "test");
    fd.set("subject", subject);
    fd.set("body", body);
    submit(fd, { method: "post" });
  };

  return (
    <Page
      backAction={{ content: "Notifications", url: "/app/notifications" }}
      title={data.label}
      titleMetadata={data.edited ? <Badge tone="info">Edited</Badge> : undefined}
      subtitle={copy.notificationsRecipient(data.to === "You" ? "you" : data.to.toLowerCase())}
      secondaryActions={
        data.edited ? [{ content: "Reset to default", onAction: () => setConfirmReset(true), disabled: busy }] : []
      }
    >
      <TitleBar title={data.label} />
      <SaveBar id={SAVE_BAR_ID}>
        <button variant="primary" onClick={save} disabled={busy}>Save</button>
        <button onClick={discard} disabled={busy}>Discard</button>
      </SaveBar>
      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset to the default wording?"
        primaryAction={{
          content: "Reset email",
          destructive: true,
          onAction: () => {
            setConfirmReset(false);
            const fd = new FormData();
            fd.set("intent", "reset");
            submit(fd, { method: "post" });
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmReset(false) }]}
      >
        <Modal.Section>
          <Text as="p">Your changes to this email are removed and Mannon’s default subject and message are used again.</Text>
        </Modal.Section>
      </Modal>
      <BlockStack gap="400">
        {saveError && <Banner tone="critical" title="Couldn’t save this email"><p>{saveError}</p></Banner>}
        {!emailDelivery && (
          <Banner tone="info" title="Not delivered yet">
            <p>Mannon isn’t connected to a sender, so this message doesn’t go out. Your wording is saved and is used wherever Mannon prepares this message for you to copy.</p>
          </Banner>
        )}
        {saved && !dirty && <Banner tone="success" title={saved} onDismiss={() => undefined} />}
        {testResult && testResult.ok && <Banner tone="success" title={testResult.message} />}
        {testResult && !testResult.ok && <Banner tone="warning" title="Test not sent"><p>{testResult.error}</p></Banner>}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
              <Text as="h2" variant="headingMd">Email</Text>
              {access.allowed && (
                <Button
                  onClick={() => ai.submit({ intent: "ai-template", currentSubject: subject, currentBody: body }, { method: "post" })}
                  loading={ai.state !== "idle"}
                >
                  ✦ Draft with Claude
                </Button>
              )}
            </InlineStack>
            {access.state === "trial" && access.daysLeft != null && (
              <InlineStack>
                <Badge tone="attention">{`Claude trial · ${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
              </InlineStack>
            )}
            <TextField label="Subject" value={subject} onChange={setSubject} autoComplete="off" />
            <TextField label="Message" value={body} onChange={setBody} autoComplete="off" multiline={8} error={problem ?? undefined} />
            {data.variables.length > 0 && (
              <Text as="p" tone="subdued" variant="bodySm">
                {`You can use: ${data.variables.map((v) => `{{${v}}}`).join(", ")}. Mannon fills these in ${emailDelivery ? "when the email is sent" : "when the message is prepared"}.`}
              </Text>
            )}
            {aiError && <Banner tone="warning">{aiError}</Banner>}
            {drafted && (
              <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">{drafted.subject}</Text>
                  <Text as="p" variant="bodySm">{drafted.body}</Text>
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Button
                      variant="primary"
                      size="slim"
                      onClick={() => {
                        setSubject(drafted.subject);
                        setBody(drafted.body);
                      }}
                    >
                      Use this draft
                    </Button>
                    <Text as="span" variant="bodySm" tone="subdued">{DRAFTED_BY_CLAUDE_TRUST}</Text>
                  </InlineStack>
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
              <Text as="h2" variant="headingMd">Preview</Text>
              <Button
                onClick={sendTest}
                disabled={busy || !emailDelivery || !data.testTo || Boolean(problem)}
                accessibilityLabel={data.testTo ? `Send a test of this email to ${data.testTo}` : "Send test to me"}
              >
                Send test to me
              </Button>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              {!emailDelivery
                ? "Tests can go out once a sender is connected."
                : data.testTo
                  ? `With sample details. A test goes to ${data.testTo}.`
                  : "With sample details. Add an alert address in Notifications to send yourself a test."}
            </Text>
            <Box background="bg-surface-secondary" borderRadius="200" padding="300">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="semibold">{preview.subject}</Text>
                <Text as="p" variant="bodyMd" breakWord>
                  <span style={{ whiteSpace: "pre-wrap" }}>{preview.body}</span>
                </Text>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>
        {!access.allowed && <UpgradeToClaude access={access} upgradeUrl={upgradeUrl("growth")} />}
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return (
    <Page backAction={{ content: "Notifications", url: "/app/notifications" }} title="Email">
      <Banner tone="critical" title="We couldn’t open this email" action={{ content: "Back to notifications", url: "/app/notifications" }}>
        <p>It may not exist any more. Your other emails are safe.</p>
      </Banner>
    </Page>
  );
}
