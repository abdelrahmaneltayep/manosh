import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Badge, ResourceList, ResourceItem, Banner, TextField, Button } from "@shopify/polaris";
import prisma from "../db.server";
import { ensureAlertEmails, parseAlertEmails } from "../services/merchant-alerts.server";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getEmailTemplates } from "../services/settings.server";
import { SectionTabs } from "../components/SectionTabs";
import { TEMPLATE_GROUPS, TEMPLATE_INFO } from "../lib/notification-templates";
import { emailCopy } from "../lib/email-delivery";
import { useEmailDelivery } from "../lib/use-email-delivery";

/**
 * Settings › Notifications — every email Mannon sends, grouped by job, one row
 * per email (Shopify admin Settings → Notifications pattern). Each row opens its
 * own edit page with a back action, instead of 34 open editors on Settings.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  // First visit: fill the alert address with the store's Shopify contact email.
  await ensureAlertEmails(session.shop, admin);
  const [overrides, shop] = await Promise.all([
    getEmailTemplates(session.shop),
    prisma.shop.findUnique({ where: { shopifyDomain: session.shop }, select: { alertEmails: true } }),
  ]);
  return {
    customized: Object.keys(overrides ?? {}),
    alertEmails: shop?.alertEmails ?? [],
    sender: process.env.MANNON_MAIL_FROM ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "alert-emails") return { ok: false as const, error: "Unknown action." };
  const { emails, invalid } = parseAlertEmails(String(form.get("alertEmails") ?? ""));
  if (invalid.length) return { ok: false as const, error: `These don’t look like email addresses: ${invalid.join(", ")}` };
  if (emails.length === 0) return { ok: false as const, error: "Add at least one address, or alerts have nowhere to go." };
  await prisma.shop.update({ where: { shopifyDomain: session.shop }, data: { alertEmails: emails } });
  return { ok: true as const, message: "Alert addresses saved." };
};

export default function Notifications() {
  const { customized, alertEmails, sender } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [alerts, setAlerts] = useState(alertEmails.join(", "));
  useEffect(() => setAlerts(alertEmails.join(", ")), [alertEmails]);
  const edited = new Set(customized);
  const emailDelivery = useEmailDelivery();
  const copy = emailCopy(emailDelivery);
  return (
    <Page>
      <TitleBar title="Notifications" />
      <SectionTabs active="notifications" />
      <BlockStack gap="400">
        {actionData && !actionData.ok && <Banner tone="critical" title="Couldn’t save"><p>{actionData.error}</p></Banner>}
        {actionData && actionData.ok && <Banner tone="success" title={actionData.message} />}
        {emailDelivery && (
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Sender</Text>
                <Badge tone="success">Connected</Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd">
                {`Emails go out from ${sender ?? "Mannon"} with your store’s name, and replies come back to that address.`}
              </Text>
            </BlockStack>
          </Card>
        )}
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="alert-emails" />
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Your alerts</Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Where Mannon tells you about new quote requests, access requests and sync problems. It
                  starts with your store’s contact email from Shopify.
                </Text>
              </BlockStack>
              <TextField
                label="Send alerts to"
                name="alertEmails"
                value={alerts}
                onChange={setAlerts}
                autoComplete="email"
                helpText="One or more addresses, separated by commas."
              />
              <InlineStack>
                <Button submit loading={navigation.state === "submitting"}>Save addresses</Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Card>
        {!emailDelivery && (
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Sender</Text>
                <Badge tone="attention">Not connected</Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd">
                Mannon isn’t connected to a sender yet, so none of the messages below are delivered.
                Until it is, use the Copy actions on quotes, follow-ups and applications to share links
                and wording yourself.
              </Text>
            </BlockStack>
          </Card>
        )}
        <Text as="p" tone="subdued">{copy.notificationsIntro}</Text>
        {TEMPLATE_GROUPS.map((group) => (
          <Card key={group.id} padding="0">
            <BlockStack gap="0">
              <div style={{ padding: "var(--p-space-400) var(--p-space-400) var(--p-space-200)" }}>
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {group.title}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {group.description}
                  </Text>
                </BlockStack>
              </div>
              <ResourceList
                resourceName={{ singular: "message", plural: "messages" }}
                items={group.keys.map((key) => ({ id: key, key }))}
                renderItem={({ key }: { id: string; key: string }) => {
                  const info = TEMPLATE_INFO[key] ?? { label: key, to: "Buyer" as const };
                  return (
                    <ResourceItem id={key} url={`/app/notifications/${key}`} accessibilityLabel={`Edit ${info.label} wording`}>
                      <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
                        <BlockStack gap="050">
                          <Text as="span" fontWeight="semibold">
                            {info.label}
                          </Text>
                          <Text as="span" tone="subdued" variant="bodySm">
                            {copy.notificationsRecipient(info.to === "You" ? "you" : info.to.toLowerCase())}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200" blockAlign="center" wrap={false}>
                          {edited.has(key) && <Badge tone="info">Edited</Badge>}
                          <Text as="span" tone="subdued" aria-hidden="true">
                            ›
                          </Text>
                        </InlineStack>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            </BlockStack>
          </Card>
        ))}
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return (
    <Page>
      <TitleBar title="Notifications" />
      <Banner tone="critical" title="We couldn’t load your notifications" action={{ content: "Try again", url: "/app/notifications" }}>
        <p>Your wording is safe. Reload the page, and if this keeps happening contact Mannon support.</p>
      </Banner>
    </Page>
  );
}
