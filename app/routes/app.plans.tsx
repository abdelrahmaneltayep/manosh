import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
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
import { requireBilling, reconcileShopPlan, managedPricingUrlFor } from "../services/billing.server";
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
  // ?upgrade=growth — set by every "Upgrade" / "See Growth" button (lib/upgrade.ts)
  // so this page can say why the merchant is here and highlight the plan they need.
  const asked = (new URL(request.url).searchParams.get("upgrade") || "").toLowerCase();
  const needed = (LADDER as string[]).includes(asked) ? (asked as PlanHandle) : null;
  return { current, needed: needed && planIndex(needed) > planIndex(current) ? needed : null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Shopify App Pricing (managed): the app never creates, changes or cancels a
  // charge. Every plan action opens Shopify's hosted plan-selection page, which
  // handles approval, trial, proration and downgrade to Free. It's on
  // admin.shopify.com, so redirect at the top level (out of the app iframe).
  // The app handle in the URL is read from the Admin API, never guessed
  // (review 1.2.2: a wrong handle 404s on Shopify's side).
  const { session, admin, redirect } = await authenticate.admin(request);
  return redirect(await managedPricingUrlFor(admin, session.shop), { target: "_top" });
};

function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export default function Plans() {
  const { current, needed } = useLoaderData<typeof loader>();
  // The one highlighted (primary) plan: the plan a feature asked for, else the
  // next plan up from the current one. A Scale merchant sees no primary button.
  const next = LADDER[planIndex(current) + 1] ?? null;
  const highlight: PlanHandle | null = needed ?? (next && next !== "free" ? next : null);
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const pendingPlan = submitting ? String(nav.formData?.get("plan") ?? "") : null;

  return (
    <Page>
      <TitleBar title="Pricing plans" />
      <BlockStack gap="400">
        {needed && (
          <Banner tone="info" title={`That feature is on the ${PLAN_DISPLAY_NAME[needed]} plan`}>
            <p>
              Choose {PLAN_DISPLAY_NAME[needed]} or a higher plan below. Shopify shows the
              price and free trial before anything changes.
            </p>
          </Banner>
        )}
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
                        variant={handle === highlight ? "primary" : "secondary"}
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
          Plans are billed and managed by Shopify. Choosing a plan opens
          Shopify&rsquo;s secure plan page, where your subscription, free trial
          and any change take effect.
        </Text>
      </BlockStack>
    </Page>
  );
}
