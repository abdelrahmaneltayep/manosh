import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Button,
  Badge,
  Banner,
  BlockStack,
  Box,
  InlineStack,
  Divider,
  Select,
  Checkbox,
  Text,
} from "@shopify/polaris";
import { TitleBar, SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  updateShopSettings,
  validateSettings,
  TERM_DAYS_OPTIONS,
} from "../services/settings.server";
import prisma from "../db.server";
import { requireBilling, reconcileShopPlan, managedPricingUrlFor } from "../services/billing.server";
import { NO_PER_ORDER_FEES_COPY, PLAN_DISPLAY_NAME, effectivePlanHandle } from "../lib/billing-v3";
import { canCreateQuote } from "../services/plan-limits.server";
import { listSeats, canAddSeat, addStaffSeat, removeSeat } from "../services/staff-seats.server";
import { PLAN_LIMITS } from "../lib/billing";
import { claudeAccess, CLAUDE_UPGRADE_COPY, type ClaudeAccess } from "../config/plans";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { SectionTabs } from "../components/SectionTabs";
import { ConfirmAction } from "../components/ConfirmAction";
import { upgradeUrl } from "../lib/upgrade";

const IS_TEST = process.env.NODE_ENV !== "production";
const SAVE_BAR_ID = "settings-general-save-bar";

/**
 * Settings › General (App Home settings pattern): one section per group —
 * Quotes and reorders · Buyer sign-in and payment terms · Draft with Claude ·
 * Team · Plan — with a contextual save bar. What used to stack here moved to
 * where it's used (docs/ux-audit.md): onboarding banners → Home's setup guide,
 * the plan comparison → Pricing plans, the 34 email templates → Notifications.
 */

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

  const [quoteAllowance, seatAllowance, seats] = shopId
    ? await Promise.all([canCreateQuote(shopId), canAddSeat(shopId), listSeats(shopId)])
    : [null, null, []];

  const shopClaude = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shopClaude ?? { plan: "FREE" }, new Date());

  return {
    access,
    claudeEnabled: shopClaude?.claudeEnabled ?? true,
    tolerancePercent: settings ? Math.round(settings.autoApproveTolerance * 100) : 0,
    quoteExpiryDays: settings?.quoteExpiryDays ?? 14,
    magicLinkExpiryDays: settings?.magicLinkExpiryDays ?? 7,
    minMarginPercent: settings ? Math.round(settings.minMarginPct * 100) : 15,
    defaultTermsDays: settings?.defaultTermsDays ?? 30,
    termDaysOptions: TERM_DAYS_OPTIONS,
    planHandle: effectivePlanHandle(shopClaude?.plan ?? null, shopClaude?.legacyPlan ?? false),
    onTrial: status.onTrial,
    paid: Boolean(status.plan),
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
  | { ok: true; kind: "claude"; claudeEnabled: boolean; message: string }
  | { ok: false; kind: "settings" | "billing" | "seat" | "claude"; error: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save-settings");

  // --- dual-mode: merchant turns Claude drafting on/off for the whole store ----
  if (intent === "claude-toggle") {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true, plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
    });
    if (!shop) {
      return { ok: false, kind: "claude", error: "Your store isn’t set up yet." } satisfies ActionResult;
    }
    // The toggle only applies where the PLAN grants Claude — a Free/locked shop
    // has nothing to switch. Guard so a hand-crafted request can't flip a flag
    // that the UI would never show.
    const access = claudeAccess(shop, new Date());
    if (!access.planGrantsClaude) {
      return {
        ok: false,
        kind: "claude",
        upgrade: true,
        error: CLAUDE_UPGRADE_COPY,
      } satisfies ActionResult;
    }
    const enabled = String(form.get("claudeEnabled") ?? "") === "true";
    await prisma.shop.update({ where: { id: shop.id }, data: { claudeEnabled: enabled } });
    return {
      ok: true,
      kind: "claude",
      claudeEnabled: enabled,
      message: enabled ? "Claude drafting is on." : "Claude drafting is off.",
    } satisfies ActionResult;
  }

  if (intent === "billing-subscribe" || intent === "billing-cancel") {
    // Shopify App Pricing (managed): the app never creates or cancels charges.
    // All plan changes happen on Shopify's hosted plan page — redirect there at
    // the top level (it lives on admin.shopify.com, outside the app iframe).
    // The app handle comes from the Admin API, never a guess (review 1.2.2).
    return redirect(await managedPricingUrlFor(admin, session.shop), { target: "_top" });
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
    minMarginPct: Number(form.get("minMarginPercent")) / 100,
    defaultTermsDays: Number(form.get("defaultTermsDays")),
  });
  if (!parsed.ok) {
    return { ok: false, kind: "settings", error: parsed.error } satisfies ActionResult;
  }
  await updateShopSettings(session.shop, parsed.settings);
  return { ok: true, kind: "settings" } satisfies ActionResult;
};

/**
 * Store-wide Claude on/off switch. Only rendered where the PLAN grants Claude
 * (included, or an active Starter trial) — a Free/locked shop sees the upgrade
 * nudge instead, never this. Flipping it persists `Shop.claudeEnabled`; when off,
 * every ✦ "Draft with Claude" control across the app hides and the server guard
 * blocks model calls, so the merchant stays fully in manual mode.
 */
function ClaudeToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== "idle";
  const d = fetcher.data;
  // Optimistic: reflect the in-flight submission, then the server's confirmed value.
  const submitted =
    fetcher.formData?.get("claudeEnabled") != null
      ? fetcher.formData.get("claudeEnabled") === "true"
      : null;
  const confirmed = d && d.ok && d.kind === "claude" ? d.claudeEnabled : null;
  const enabled = submitted ?? confirmed ?? initialEnabled;
  const err = d && !d.ok && d.kind === "claude" ? d.error : null;
  const ok = d && d.ok && d.kind === "claude" ? d.message : null;

  return (
    <BlockStack gap="150">
      <Checkbox
        label="Use Claude to draft"
        helpText="Adds ✦ Draft with Claude to quotes, offers, follow-ups and emails across this store. Turn it off to keep every screen manual."
        checked={enabled}
        disabled={saving}
        onChange={(next) => fetcher.submit({ intent: "claude-toggle", claudeEnabled: String(next) }, { method: "post" })}
      />
      {err && <Banner tone="warning">{err}</Banner>}
      {ok && !err && (
        <Text as="span" variant="bodySm" tone="subdued">
          {ok}
        </Text>
      )}
    </BlockStack>
  );
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";

  const initial = {
    tolerance: String(data.tolerancePercent),
    quoteExpiry: String(data.quoteExpiryDays),
    linkExpiry: String(data.magicLinkExpiryDays),
    minMargin: String(data.minMarginPercent),
    defaultTerms: String(data.defaultTermsDays),
  };
  const [tolerance, setTolerance] = useState(initial.tolerance);
  const [quoteExpiry, setQuoteExpiry] = useState(initial.quoteExpiry);
  const [linkExpiry, setLinkExpiry] = useState(initial.linkExpiry);
  const [minMargin, setMinMargin] = useState(initial.minMargin);
  const [defaultTerms, setDefaultTerms] = useState(initial.defaultTerms);
  const [seatEmail, setSeatEmail] = useState("");

  // Contextual save bar (BFS 4.1.5): every change shows Save / Discard, and the
  // merchant can't leave the page with unsaved edits without choosing one.
  const dirty =
    tolerance !== initial.tolerance ||
    quoteExpiry !== initial.quoteExpiry ||
    linkExpiry !== initial.linkExpiry ||
    minMargin !== initial.minMargin ||
    defaultTerms !== initial.defaultTerms;
  useEffect(() => {
    if (dirty) shopify.saveBar.show(SAVE_BAR_ID);
    else shopify.saveBar.hide(SAVE_BAR_ID);
  }, [dirty, shopify]);
  const save = () => {
    const fd = new FormData();
    fd.set("intent", "save-settings");
    fd.set("tolerancePercent", tolerance);
    fd.set("quoteExpiryDays", quoteExpiry);
    fd.set("magicLinkExpiryDays", linkExpiry);
    fd.set("minMarginPercent", minMargin);
    fd.set("defaultTermsDays", defaultTerms);
    submit(fd, { method: "post" });
  };
  const discard = () => {
    setTolerance(initial.tolerance);
    setQuoteExpiry(initial.quoteExpiry);
    setLinkExpiry(initial.linkExpiry);
    setMinMargin(initial.minMargin);
    setDefaultTerms(initial.defaultTerms);
  };

  const settingsError =
    actionData && !actionData.ok && actionData.kind === "settings" ? actionData.error : null;
  const settingsSaved = actionData?.ok === true && actionData.kind === "settings" && !dirty;
  const seatMessage = actionData?.ok === true && actionData.kind === "seat" ? actionData.message : null;
  const seatError = actionData && !actionData.ok && actionData.kind === "seat" ? actionData.error : null;

  const usage = data.quoteUsage;
  const planName = PLAN_DISPLAY_NAME[data.planHandle];

  return (
    <Page>
      <TitleBar title="Settings" />
      <SaveBar id={SAVE_BAR_ID}>
        <button variant="primary" onClick={save} disabled={submitting}>Save</button>
        <button onClick={discard} disabled={submitting}>Discard</button>
      </SaveBar>
      <SectionTabs active="general" />
      <BlockStack gap="400">
        {settingsError && (
          <Banner tone="critical" title="Couldn’t save settings">
            <p>{settingsError}</p>
          </Banner>
        )}
        {settingsSaved && <Banner tone="success" title="Settings saved" />}

        {/* Settings pattern: one section per group, heading + one-line description. */}
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Quotes and reorders</Text>
              <Text as="p" tone="subdued" variant="bodySm">How long quotes stay open, and which reorders go through on their own.</Text>
            </BlockStack>
            <FormLayout>
              <FormLayout.Group>
                <TextField
                  label="Quote expiry"
                  type="number"
                  value={quoteExpiry}
                  onChange={setQuoteExpiry}
                  min={1}
                  max={365}
                  suffix="days"
                  autoComplete="off"
                  helpText="How long a quote stays open before it expires."
                />
                <TextField
                  label="Reorder auto-approve tolerance"
                  type="number"
                  value={tolerance}
                  onChange={setTolerance}
                  min={0}
                  max={100}
                  suffix="%"
                  autoComplete="off"
                  helpText="Reorders whose prices moved by less than this become a draft order on their own. Bigger changes wait for you. 0% means you approve every reorder."
                />
              </FormLayout.Group>
            </FormLayout>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Buyer sign-in and payment terms</Text>
              <Text as="p" tone="subdued" variant="bodySm">Passwordless links and the terms new invoices use.</Text>
            </BlockStack>
            <FormLayout>
              <FormLayout.Group>
                <TextField
                  label="Sign-in link expiry"
                  type="number"
                  value={linkExpiry}
                  onChange={setLinkExpiry}
                  min={1}
                  max={90}
                  suffix="days"
                  autoComplete="off"
                  helpText="How long a buyer’s sign-in link stays valid."
                />
                <Select
                  label="Default net terms"
                  options={data.termDaysOptions.map((t) => ({ label: `Net ${t}`, value: String(t) }))}
                  value={defaultTerms}
                  onChange={setDefaultTerms}
                  helpText="Sets an invoice’s due date unless the company has its own credit terms."
                />
              </FormLayout.Group>
            </FormLayout>
            <Text as="p" tone="subdued" variant="bodySm">
              Totals and tax are always calculated by Shopify. Mannon never computes them.
            </Text>
          </BlockStack>
        </Card>

        {/* Claude: the on/off switch and the guardrail on its price suggestions. */}
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Draft with Claude</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Claude pre-fills drafts for you to review. It never sends anything on its own.
              </Text>
            </BlockStack>
            {data.access.planGrantsClaude ? (
              <ClaudeToggle initialEnabled={data.claudeEnabled} />
            ) : (
              <UpgradeToClaude access={data.access as ClaudeAccess} upgradeUrl={upgradeUrl("growth")} />
            )}
            <TextField
              label="Lowest margin Claude may suggest"
              type="number"
              value={minMargin}
              onChange={setMinMargin}
              min={0}
              max={95}
              suffix="%"
              autoComplete="off"
              helpText="Claude won’t knowingly suggest a counter-offer below this margin. Suggestions that would go below it are flagged and can’t be used in one click."
            />
          </BlockStack>
        </Card>

        {/* Team seats */}
        {data.seatUsage && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Team</Text>
                  <Text as="p" tone="subdued" variant="bodySm">Staff who can manage quotes in Mannon.</Text>
                </BlockStack>
                <Badge tone={data.seatUsage.allowed ? undefined : "attention"}>
                  {`${data.seatUsage.used} of ${data.seatUsage.cap} seats used`}
                </Badge>
              </InlineStack>

              {seatError && <Banner tone="warning"><p>{seatError}</p></Banner>}
              {seatMessage && <Banner tone="success"><p>{seatMessage}</p></Banner>}

              {data.seats.length === 0 ? (
                <Text as="p" tone="subdued" variant="bodyMd">
                  No teammates yet. Invite someone to help manage quotes.
                </Text>
              ) : (
                <BlockStack gap="0">
                  {data.seats.map((seat, i) => (
                    <div key={seat.id}>
                      {i > 0 && <Divider />}
                      <Box paddingBlock="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodyMd">{seat.email}</Text>
                          <ConfirmAction
                            label="Remove"
                            variant="plain"
                            title={`Remove ${seat.email}?`}
                            message="They lose access to Mannon right away. You can invite them again later."
                            confirmLabel="Remove teammate"
                            fields={{ intent: "seat-remove", seatId: seat.id }}
                          />
                        </InlineStack>
                      </Box>
                    </div>
                  ))}
                </BlockStack>
              )}

              {data.seatUsage.allowed ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="seat-invite" />
                  <InlineStack gap="200" blockAlign="end" wrap>
                    <Box minWidth="18rem">
                      <TextField
                        label="Invite a teammate by email"
                        type="email"
                        name="email"
                        value={seatEmail}
                        onChange={setSeatEmail}
                        autoComplete="email"
                        placeholder="teammate@yourstore.com"
                      />
                    </Box>
                    <Button submit loading={submitting && navigation.formData?.get("intent") === "seat-invite"}>Send invite</Button>
                  </InlineStack>
                </Form>
              ) : (
                <Banner tone="info" title="All seats are in use" action={{ content: "See plans", url: upgradeUrl("growth") }}>
                  <p>
                    Your plan includes {data.seatUsage.cap} seat{data.seatUsage.cap === 1 ? "" : "s"}. Growth includes up to{" "}
                    {data.limits.growth.seats}.
                  </p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}

        {/* Plan — a summary; comparing plans lives on Pricing plans. */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="200">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Plan</Text>
                <Text as="p" tone="subdued" variant="bodySm">{NO_PER_ORDER_FEES_COPY}</Text>
              </BlockStack>
              <Badge tone="success">{data.onTrial ? `${planName} · trial` : planName}</Badge>
            </InlineStack>
            {usage && (
              <Text as="p" variant="bodyMd">
                {usage.cap === null
                  ? `${usage.used} active quotes this month. Your plan has no quote limit.`
                  : `${usage.used} of ${usage.cap} active quotes used this month.`}
              </Text>
            )}
            <InlineStack gap="200" blockAlign="center">
              <Button url="/app/plans">Compare plans</Button>
              {data.paid && (
                <Form method="post">
                  <input type="hidden" name="intent" value="billing-cancel" />
                  <Button submit variant="plain">Change or cancel in Shopify</Button>
                </Form>
              )}
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
