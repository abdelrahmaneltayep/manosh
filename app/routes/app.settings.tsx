import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  Badge,
  Banner,
  BlockStack,
  InlineGrid,
  InlineStack,
  Divider,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  updateShopSettings,
  validateSettings,
} from "../services/settings.server";
import { requireBilling, reconcileShopPlan } from "../services/billing.server";
import { cancelPlan } from "../services/billing-actions.server";
import {
  planMeets,
  GROWTH_FEATURES,
  PLAN_PRICING,
  STARTER_PLAN,
  GROWTH_PLAN,
  type PlanName,
} from "../lib/billing";

const IS_TEST = process.env.NODE_ENV !== "production";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  const status = await requireBilling(billing, { isTest: IS_TEST });
  // Shopify is the source of truth — reconcile it onto our Shop row (this is
  // also where TRIAL_STARTED / PLAN_UPGRADED / PLAN_CANCELLED get recorded).
  await reconcileShopPlan(session.shop, status);

  const settings = await getShopSettings(session.shop);
  const upgradeTarget = new URL(request.url).searchParams.get("upgrade");

  return {
    tolerancePercent: settings ? Math.round(settings.autoApproveTolerance * 100) : 0,
    quoteExpiryDays: settings?.quoteExpiryDays ?? 14,
    magicLinkExpiryDays: settings?.magicLinkExpiryDays ?? 7,
    plan: status.plan,
    onTrial: status.onTrial,
    growthFeatures: GROWTH_FEATURES,
    upgradeTarget:
      upgradeTarget === STARTER_PLAN || upgradeTarget === GROWTH_PLAN
        ? (upgradeTarget as PlanName)
        : null,
    pricing: PLAN_PRICING,
  };
};

type ActionResult =
  | { ok: true; kind: "settings" }
  | { ok: true; kind: "billing"; message: string }
  | { ok: false; kind: "settings" | "billing"; error: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save-settings");

  if (intent === "billing-subscribe") {
    const plan = String(form.get("plan") ?? "");
    if (plan !== STARTER_PLAN && plan !== GROWTH_PLAN) {
      return { ok: false, kind: "billing", error: "Choose a valid plan." } satisfies ActionResult;
    }
    const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    // Always redirects to Shopify's confirmation page (Promise<never>); the
    // return trip lands back on settings, where the loader reconciles the plan.
    await billing.request({
      plan,
      isTest: IS_TEST,
      returnUrl: `${appUrl}/app/settings`,
    });
    return null; // unreachable — request() throws the redirect
  }

  if (intent === "billing-cancel") {
    const status = await requireBilling(billing, { isTest: IS_TEST });
    const { cancelled } = await cancelPlan(billing, session.shop, status, {
      isTest: IS_TEST,
    });
    return {
      ok: true,
      kind: "billing",
      message: cancelled
        ? "Your subscription was cancelled."
        : "There was no active subscription to cancel.",
    } satisfies ActionResult;
  }

  const parsed = validateSettings({
    autoApproveTolerance: Number(form.get("tolerancePercent")) / 100,
    quoteExpiryDays: Number(form.get("quoteExpiryDays")),
    magicLinkExpiryDays: Number(form.get("magicLinkExpiryDays")),
  });
  if (!parsed.ok) {
    return { ok: false, kind: "settings", error: parsed.error } satisfies ActionResult;
  }
  await updateShopSettings(session.shop, parsed.settings);
  return { ok: true, kind: "settings" } satisfies ActionResult;
};

function PlanOption({
  name,
  price,
  current,
  submitting,
}: {
  name: PlanName;
  price: number;
  current: PlanName | null;
  submitting: boolean;
}) {
  const isCurrent = current === name;
  // "Upgrade" when moving up (or from trial), "Switch" when moving down.
  const label = !current || planMeets(name, current) ? `Choose ${name}` : `Switch to ${name}`;
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {name}
          </Text>
          {isCurrent && <Badge tone="success">Current plan</Badge>}
        </InlineStack>
        <Text as="p" variant="headingLg">
          ${price}
          <Text as="span" variant="bodySm" tone="subdued">
            {" "}
            / month
          </Text>
        </Text>
        {isCurrent ? (
          <Button disabled>Current plan</Button>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="billing-subscribe" />
            <input type="hidden" name="plan" value={name} />
            <Button submit variant={name === GROWTH_PLAN ? "primary" : "secondary"} loading={submitting}>
              {label}
            </Button>
          </Form>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [tolerance, setTolerance] = useState(String(data.tolerancePercent));
  const [quoteExpiry, setQuoteExpiry] = useState(String(data.quoteExpiryDays));
  const [linkExpiry, setLinkExpiry] = useState(String(data.magicLinkExpiryDays));

  const settingsError =
    actionData && !actionData.ok && actionData.kind === "settings" ? actionData.error : null;
  const settingsSaved =
    actionData?.ok === true && actionData.kind === "settings";
  const billingMessage =
    actionData?.ok === true && actionData.kind === "billing" ? actionData.message : null;

  const hasGrowth = planMeets(data.plan, GROWTH_PLAN);
  const planLabel = data.plan ?? "Free trial";

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="500">
        {data.upgradeTarget && !planMeets(data.plan, data.upgradeTarget) && (
          <Banner tone="warning" title={`That feature needs the ${data.upgradeTarget} plan`}>
            <p>Choose {data.upgradeTarget} below to unlock it.</p>
          </Banner>
        )}
        {billingMessage && <Banner tone="success" title={billingMessage} />}

        {/* Plan & billing */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Plan &amp; billing
              </Text>
              <Badge tone={data.plan ? "success" : "attention"}>{planLabel}</Badge>
            </InlineStack>
            {data.onTrial && (
              <Text as="p" tone="subdued" variant="bodyMd">
                You&rsquo;re on the free trial. Choose a plan to keep Mannon once
                it ends — you won&rsquo;t be charged until the trial is over.
              </Text>
            )}

            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
              <PlanOption
                name={STARTER_PLAN}
                price={data.pricing[STARTER_PLAN].amount}
                current={data.plan}
                submitting={submitting}
              />
              <PlanOption
                name={GROWTH_PLAN}
                price={data.pricing[GROWTH_PLAN].amount}
                current={data.plan}
                submitting={submitting}
              />
            </InlineGrid>

            <Divider />

            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Growth features
                </Text>
                <Badge tone={hasGrowth ? "success" : undefined}>
                  {hasGrowth ? "Included" : "Growth plan"}
                </Badge>
              </InlineStack>
              {data.growthFeatures.map((feature) => (
                <InlineStack key={feature.key} align="space-between" blockAlign="start" gap="400">
                  <BlockStack gap="0">
                    <Text as="span" fontWeight="semibold">
                      {feature.name}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {feature.description}
                    </Text>
                  </BlockStack>
                  <Badge tone={hasGrowth ? "success" : undefined}>
                    {hasGrowth ? "Available" : "Locked"}
                  </Badge>
                </InlineStack>
              ))}
            </BlockStack>

            {data.plan && (
              <>
                <Divider />
                <Form method="post">
                  <input type="hidden" name="intent" value="billing-cancel" />
                  <Button submit variant="plain" tone="critical" loading={submitting}>
                    Cancel subscription
                  </Button>
                </Form>
              </>
            )}
          </BlockStack>
        </Card>

        {/* Merchant settings */}
        {settingsError && (
          <Banner tone="critical" title="Couldn’t save settings">
            <p>{settingsError}</p>
          </Banner>
        )}
        {settingsSaved && <Banner tone="success" title="Settings saved" />}

        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save-settings" />
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
              <Button variant="primary" submit loading={submitting}>
                Save
              </Button>
            </FormLayout>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}
