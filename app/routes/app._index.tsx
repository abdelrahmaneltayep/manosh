import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

// S1 placeholder home. This becomes the ROI dashboard in S13 (F5), built
// entirely from the Event stream. For now it confirms the embedded shell
// boots and renders Polaris inside Shopify Admin.
export default function Index() {
  return (
    <Page>
      <TitleBar title="Mannon" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Welcome to Mannon
                </Text>
                <Text as="p" variant="bodyMd">
                  B2B wholesale quoting and one-tap reorder, built on your
                  store&rsquo;s native B2B. Your quote inbox, reorder insights,
                  and the &ldquo;revenue made for you&rdquo; dashboard will
                  appear here as you set things up.
                </Text>
                <Text as="h3" variant="headingSm">
                  What&rsquo;s next
                </Text>
                <List>
                  <List.Item>
                    Invite your buyers with a secure magic link.
                  </List.Item>
                  <List.Item>
                    Receive and counter quote requests from your inbox.
                  </List.Item>
                  <List.Item>
                    Let buyers reorder past orders in one tap.
                  </List.Item>
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
