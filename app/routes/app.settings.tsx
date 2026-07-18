import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  updateShopSettings,
  validateSettings,
} from "../services/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return {
    tolerancePercent: settings ? Math.round(settings.autoApproveTolerance * 100) : 0,
    quoteExpiryDays: settings?.quoteExpiryDays ?? 14,
    magicLinkExpiryDays: settings?.magicLinkExpiryDays ?? 7,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const parsed = validateSettings({
    autoApproveTolerance: Number(form.get("tolerancePercent")) / 100,
    quoteExpiryDays: Number(form.get("quoteExpiryDays")),
    magicLinkExpiryDays: Number(form.get("magicLinkExpiryDays")),
  });
  if (!parsed.ok) {
    return { ok: false as const, error: parsed.error };
  }
  await updateShopSettings(session.shop, parsed.settings);
  return { ok: true as const };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [tolerance, setTolerance] = useState(String(data.tolerancePercent));
  const [quoteExpiry, setQuoteExpiry] = useState(String(data.quoteExpiryDays));
  const [linkExpiry, setLinkExpiry] = useState(String(data.magicLinkExpiryDays));

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="400">
        {actionData?.ok === false && (
          <Banner tone="critical" title="Couldn’t save settings">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {actionData?.ok === true && <Banner tone="success" title="Settings saved" />}

        <Card>
          <Form method="post">
            <FormLayout>
              <TextField
                label="Reorder auto-approve tolerance (%)"
                type="number"
                name="tolerancePercent"
                value={tolerance}
                onChange={setTolerance}
                min={0}
                max={100}
                suffix="%"
                autoComplete="off"
                helpText="Reorders whose prices moved within this percentage are converted to a draft order automatically. Larger changes wait for your approval. 0% means every reorder needs approval."
              />
              <TextField
                label="Quote expiry (days)"
                type="number"
                name="quoteExpiryDays"
                value={quoteExpiry}
                onChange={setQuoteExpiry}
                min={1}
                max={365}
                autoComplete="off"
                helpText="How long a quote stays open before it expires."
              />
              <TextField
                label="Magic-link expiry (days)"
                type="number"
                name="magicLinkExpiryDays"
                value={linkExpiry}
                onChange={setLinkExpiry}
                min={1}
                max={90}
                autoComplete="off"
                helpText="How long a buyer sign-in link stays valid."
              />
              <Text as="p" tone="subdued" variant="bodySm">
                Totals and tax are always calculated by Shopify — Mannon never
                computes them.
              </Text>
              <Button variant="primary" submit loading={saving}>
                Save
              </Button>
            </FormLayout>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}
