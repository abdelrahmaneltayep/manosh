import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Banner,
  BlockStack,
  Button,
  Card,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";
import { APP_STORE_URL } from "../../lib/app-store";

import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

/**
 * Where Shopify's auth sends a request that needs a shop. A `?shop=` hand-off
 * from Shopify goes straight on to OAuth (login() redirects). Otherwise this
 * page explains how to open or install Mannon. It never asks for a shop domain
 * (App Store requirement 2.3.1: installs start on a Shopify-owned surface), so
 * there is no form and no action.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { errors, polarisTranslations };
};

export default function Auth() {
  const { errors, polarisTranslations: i18n } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider i18n={i18n}>
      <Page narrowWidth>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingLg" as="h1">
              Open Mannon from Shopify
            </Text>
            {errors.shop && <Banner tone="warning">{errors.shop}</Banner>}
            <Text as="p">Mannon runs inside your Shopify admin, so there’s nothing to log in to here.</Text>
            <List type="number">
              <List.Item>
                Already installed: in your Shopify admin, open <strong>Apps → Mannon</strong>.
              </List.Item>
              <List.Item>New to Mannon: install it from the Shopify App Store.</List.Item>
            </List>
            <div>
              <Button variant="primary" url={APP_STORE_URL} target="_top">
                Install from the Shopify App Store
              </Button>
            </div>
          </BlockStack>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
