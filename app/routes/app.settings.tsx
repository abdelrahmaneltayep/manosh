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
import { canCreateQuote } from "../services/plan-limits.server";
import {
  listSeats,
  canAddSeat,
  addStaffSeat,
  removeSeat,
} from "../services/staff-seats.server";
import {
  planMeets,
  PLAN_LIMITS,
  PLAN_PRICING,
  STARTER_PLAN,
  GROWTH_PLAN,
  type PlanName,
} from "../lib/billing";

const IS_TEST = process.env.NODE_ENV !== "production";

// PLAN_LIMITS with Infinity → null for JSON serialisation (null = unlimited).
const PLAN_LIMIT_DISPLAY = {
  starter: {
    quotes: Number.isFinite(PLAN_LIMITS.starter.activeQuoteCap) ? PLAN_LIMITS.starter.activeQuoteCap : null,
    seats: PLAN_LIMITS.starter.seatCap,
  },
  growth: {
    quotes: Number.isFinite(PLAN_LIMITS.growth.activeQuoteCap) ? PLAN_LIMITS.growth.activeQuoteCap : null,
    seats: PLAN_LIMITS.growth.seatCap,
  },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  const status = await requireBilling(billing, { isTest: IS_TEST });
  await reconcileShopPlan(session.shop, status);

  const settings = await getShopSettings(session.shop);
  const shopId = settings?.id ?? null;
  const upgradeTarget = new URL(request.url).searchParams.get("upgrade");

  const [quoteAllowance, seatAllowance, seats] = shopId
    ? await Promise.all([canCreateQuote(shopId), canAddSeat(shopId), listSeats(shopId)])
    : [null, null, []];

  return {
    tolerancePercent: settings ? Math.round(settings.autoApproveTolerance * 100) : 0,
    quoteExpiryDays: settings?.quoteExpiryDays ?? 14,
    magicLinkExpiryDays: settings?.magicLinkExpiryDays ?? 7,
    plan: status.plan,
    onTrial: status.onTrial,
    upgradeTarget:
      upgradeTarget === STARTER_PLAN || upgradeTarget === GROWTH_PLAN
        ? (upgradeTarget as PlanName)
        : null,
    pricing: PLAN_PRICING,
    limits: PLAN_LIMIT_DISPLAY,
    quoteUsage: quoteAllowance
      ? { used: quoteAllowance.used, cap: Number.isFinite(quoteAllowance.cap) ? quoteAllowance.cap : null }
      : null,
    seatUsage: seatAllowance
      ? { used: seatAllowance.used, cap: seatAllowance.cap, allowed: seatAllowance.allowed }
      : null,
    seats: seats.map((s) => ({ id: s.id, email: s.email })),
  };
};

type ActionResult =
  | { ok: true; kind: "settings" }
  | { ok: true; kind: "billing"; message: string }
  | { ok: true; kind: "seat"; message: string }
  | { ok: false; kind: "settings" | "billing" | "seat"; error: string };

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
    await billing.request({ plan, isTest: IS_TEST, returnUrl: `${appUrl}/app/settings` });
    return null; // unreachable — request() throws the redirect
  }

  if (intent === "billing-cancel") {
    const status = await requireBilling(billing, { isTest: IS_TEST });
    const { cancelled } = await cancelPlan(billing, session.shop, status, { isTest: IS_TEST });
    return {
      ok: true,
      kind: "billing",
      message: cancelled
        ? "Your subscription was cancelled."
        : "There was no active subscription to cancel.",
    } satisfies ActionResult;
  }

  if (intent === "seat-invite" || intent === "seat-remove") {
    const settings = await getShopSettings(session.shop);
    if (!settings) {
      return { ok: false, kind: "seat", error: "Your store isn’t set up yet." } satisfies ActionResult;
    }
    if (intent === "seat-remove") {
      await removeSeat(settings.id, String(form.get("seatId") ?? ""));
      return { ok: true, kind: "seat", message: "Seat removed." } satisfies ActionResult;
    }
    const result = await addStaffSeat(settings.id, String(form.get("email") ?? ""));
    return result.ok
      ? ({ ok: true, kind: "seat", message: `Invited ${result.seat.email}.` } satisfies ActionResult)
      : ({ ok: false, kind: "seat", error: result.error } satisfies ActionResult);
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

function limitLine(quotes: number | null, seats: number) {
  const q = quotes === null ? "Unlimited quotes" : `Up to ${quotes} active quotes / mo`;
  return `${q} · ${seats} seat${seats === 1 ? "" : "s"}`;
}

function PlanOption({
  name,
  price,
  limits,
  current,
  submitting,
}: {
  name: PlanName;
  price: number;
  limits: { quotes: number | null; seats: number };
  current: PlanName | null;
  submitting: boolean;
}) {
  const isCurrent = current === name;
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
        <Text as="p" variant="bodySm" tone="subdued">
          {limitLine(limits.quotes, limits.seats)}
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
  const [seatEmail, setSeatEmail] = useState("");

  const settingsError =
    actionData && !actionData.ok && actionData.kind === "settings" ? actionData.error : null;
  const settingsSaved = actionData?.ok === true && actionData.kind === "settings";
  const billingMessage = actionData?.ok === true && actionData.kind === "billing" ? actionData.message : null;
  const seatMessage = actionData?.ok === true && actionData.kind === "seat" ? actionData.message : null;
  const seatError = actionData && !actionData.ok && actionData.kind === "seat" ? actionData.error : null;

  const planLabel = data.plan ?? "Free trial";
  const usage = data.quoteUsage;
  const nearCap = usage && usage.cap !== null && usage.used >= usage.cap * 0.8;

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="500">
        {data.upgradeTarget && !planMeets(data.plan, data.upgradeTarget) && (
          <Banner tone="warning" title={`That needs the ${data.upgradeTarget} plan`}>
            <p>Choose {data.upgradeTarget} below.</p>
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
            <Text as="p" tone="subdued" variant="bodyMd">
              Every feature — quote builder, buyer portal, net terms, AI Order Pad,
              and reorder — is included on both plans. Plans differ only by quote
              volume and team seats.
            </Text>

            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
              <PlanOption
                name={STARTER_PLAN}
                price={data.pricing[STARTER_PLAN].amount}
                limits={data.limits.starter}
                current={data.plan}
                submitting={submitting}
              />
              <PlanOption
                name={GROWTH_PLAN}
                price={data.pricing[GROWTH_PLAN].amount}
                limits={data.limits.growth}
                current={data.plan}
                submitting={submitting}
              />
            </InlineGrid>

            {usage && (
              <>
                <Divider />
                {usage.cap === null ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Quote usage: <b>{usage.used}</b> active this month · Unlimited on Growth.
                  </Text>
                ) : (
                  <BlockStack gap="150">
                    <Text as="p" variant="bodyMd">
                      Quote usage: <b>{usage.used} / {usage.cap}</b> active quotes this month.
                    </Text>
                    {nearCap && (
                      <Banner tone={usage.used >= usage.cap ? "critical" : "warning"}>
                        <p>
                          {usage.used >= usage.cap
                            ? "You’ve reached your Starter quote limit. Upgrade to Growth for unlimited quotes."
                            : "You’re close to your Starter quote limit. Upgrade to Growth for unlimited quotes."}
                        </p>
                      </Banner>
                    )}
                  </BlockStack>
                )}
              </>
            )}

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

        {/* Team seats */}
        {data.seatUsage && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Team seats
                </Text>
                <Badge tone={data.seatUsage.allowed ? undefined : "attention"}>
                  {`${data.seatUsage.used} / ${data.seatUsage.cap} used`}
                </Badge>
              </InlineStack>

              {seatError && <Banner tone="warning"><p>{seatError}</p></Banner>}
              {seatMessage && <Banner tone="success"><p>{seatMessage}</p></Banner>}

              {data.seats.length === 0 ? (
                <Text as="p" tone="subdued" variant="bodyMd">
                  No staff invited yet. Add a teammate to help manage quotes.
                </Text>
              ) : (
                <BlockStack gap="0">
                  {data.seats.map((seat, i) => (
                    <div key={seat.id}>
                      {i > 0 && <Divider />}
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodyMd">{seat.email}</Text>
                        <Form method="post">
                          <input type="hidden" name="intent" value="seat-remove" />
                          <input type="hidden" name="seatId" value={seat.id} />
                          <Button submit variant="plain" tone="critical">Remove</Button>
                        </Form>
                      </InlineStack>
                    </div>
                  ))}
                </BlockStack>
              )}

              <Divider />
              {data.seatUsage.allowed ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="seat-invite" />
                  <FormLayout>
                    <TextField
                      label="Invite a teammate by email"
                      type="email"
                      name="email"
                      value={seatEmail}
                      onChange={setSeatEmail}
                      autoComplete="email"
                      placeholder="teammate@yourstore.com"
                    />
                    <Button submit loading={submitting}>Add seat</Button>
                  </FormLayout>
                </Form>
              ) : (
                <Banner tone="info" title="Seat limit reached">
                  <p>
                    Your plan includes {data.seatUsage.cap} seat
                    {data.seatUsage.cap === 1 ? "" : "s"}. Upgrade to Growth above for up
                    to {data.limits.growth.seats} seats.
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}

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
