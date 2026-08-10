import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Badge,
  Banner,
  Button,
  Box,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireBilling, reconcileShopPlan } from "../services/billing.server";
import { cancelPlan } from "../services/billing-actions.server";
import {
  PLAN_PRICING_V3,
  PLAN_DISPLAY_NAME,
  effectivePlanHandle,
  planIndex,
  NO_PER_ORDER_FEES_COPY,
  type PlanHandle,
} from "../lib/billing-v3";

const IS_TEST = process.env.NODE_ENV !== "production";

/** The published ladder, in order. `free` is the downgrade target, not a charge. */
const LADDER: PlanHandle[] = ["free", "starter", "growth", "scale"];

/** Honest, plain-language highlights per plan (Polaris content guidelines). */
const HIGHLIGHTS: Record<PlanHandle, string[]> = {
  free: ["Up to 10 quotes / month", "1 company account", "Quick order + reorder"],
  starter: ["Unlimited quotes", "5 company accounts", "1 custom price list", "Storefront quote widget"],
  growth: [
    "Everything in Starter",
    "✦ Draft with Claude on every screen",
    "Net terms + deposits",
    "25 company accounts · 10 price lists",
    "Make-an-Offer rules + full analytics",
  ],
  scale: [
    "Everything in Growth",
    "Sales-rep portal",
    "Accounting + ERP sync",
    "White-label / agency mode",
    "Unlimited companies, price lists & offer rules",
  ],
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const status = await requireBilling(billing, { isTest: IS_TEST });
  await reconcileShopPlan(session.shop, status);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true },
  });
  const current = effectivePlanHandle(shop?.plan ?? null, shop?.legacyPlan ?? false);
  return { current };
};

type ActionResult = { ok: false; error: string } | { ok: true; message: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const plan = String(form.get("plan") ?? "");

  // Downgrade to Free = cancel the active subscription.
  if (plan === "free") {
    const status = await requireBilling(billing, { isTest: IS_TEST });
    const { cancelled } = await cancelPlan(billing, session.shop, status, { isTest: IS_TEST });
    return {
      ok: true,
      message: cancelled ? "Moved to the Free plan." : "You're already on the Free plan.",
    } satisfies ActionResult;
  }

  if (plan !== "starter" && plan !== "growth" && plan !== "scale") {
    return { ok: false, error: "Choose a valid plan." } satisfies ActionResult;
  }

  // The return URL MUST carry the embedded context (shop + host) or Shopify's
  // post-approval redirect lands on the OAuth "enter your store" page and the
  // subscription is never reconciled (App Store review 1.2.3).
  const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const host = new URL(request.url).searchParams.get("host") ?? "";
  const back = new URLSearchParams({ shop: session.shop, embedded: "1" });
  if (host) back.set("host", host);
  await billing.request({
    plan: plan as never, // v3 handle; present in ACTIVE_BILLING_CONFIG when the flag is on
    isTest: IS_TEST,
    returnUrl: `${appUrl}/app/plans?${back.toString()}`,
  });
  return null; // unreachable — request() throws the redirect
};

function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export default function Plans() {
  const { current } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const pendingPlan = submitting ? String(nav.formData?.get("plan") ?? "") : null;

  return (
    <Page>
      <TitleBar title="Pricing plans" />
      <BlockStack gap="400">
        {actionData?.ok === true && <Banner tone="success" title={actionData.message} />}
        {actionData?.ok === false && <Banner tone="critical" title={actionData.error} />}

        <Text as="p" tone="subdued" variant="bodySm">
          {NO_PER_ORDER_FEES_COPY}
        </Text>

        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
          {LADDER.map((handle) => {
            const price = PLAN_PRICING_V3[handle];
            const isCurrent = handle === current;
            const isDowngrade = planIndex(handle) < planIndex(current);
            const cta = isCurrent
              ? "Current plan"
              : handle === "free"
                ? "Downgrade to Free"
                : isDowngrade
                  ? `Switch to ${PLAN_DISPLAY_NAME[handle]}`
                  : `Choose ${PLAN_DISPLAY_NAME[handle]}`;
            return (
              <Card key={handle}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      {PLAN_DISPLAY_NAME[handle]}
                    </Text>
                    {isCurrent && <Badge tone="success">Current</Badge>}
                  </InlineStack>
                  <Text as="p" variant="headingLg">
                    {dollars(price.monthlyCents)}
                    <Text as="span" variant="bodySm" tone="subdued">
                      {" "}
                      / month
                    </Text>
                  </Text>
                  {price.trialDays > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {price.trialDays}-day free trial
                    </Text>
                  )}
                  <Box minHeight="132px">
                    <List type="bullet">
                      {HIGHLIGHTS[handle].map((h) => (
                        <List.Item key={h}>{h}</List.Item>
                      ))}
                    </List>
                  </Box>
                  {isCurrent ? (
                    <Button disabled>Current plan</Button>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="plan" value={handle} />
                      <Button
                        submit
                        variant={handle === "growth" ? "primary" : "secondary"}
                        loading={pendingPlan === handle}
                        tone={handle === "free" ? "critical" : undefined}
                      >
                        {cta}
                      </Button>
                    </Form>
                  )}
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>

        <Text as="p" tone="subdued" variant="bodySm">
          Prices are billed through Shopify. Upgrades take effect immediately; a
          downgrade to Free cancels your current subscription.
        </Text>
      </BlockStack>
    </Page>
  );
}
