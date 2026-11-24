import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Badge, ResourceList, ResourceItem, Banner } from "@shopify/polaris";
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
  const { session } = await authenticate.admin(request);
  const overrides = await getEmailTemplates(session.shop);
  return { customized: Object.keys(overrides ?? {}) };
};

export default function Notifications() {
  const { customized } = useLoaderData<typeof loader>();
  const edited = new Set(customized);
  const emailDelivery = useEmailDelivery();
  const copy = emailCopy(emailDelivery);
  return (
    <Page>
      <TitleBar title="Notifications" />
      <SectionTabs active="notifications" />
      <BlockStack gap="400">
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
