import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
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
  InlineGrid,
  InlineStack,
  Divider,
  Select,
  Checkbox,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  updateShopSettings,
  validateSettings,
  getEmailTemplates,
  saveEmailTemplates,
  TERM_DAYS_OPTIONS,
} from "../services/settings.server";
import {
  DEFAULT_TEMPLATES,
  resolveTemplate,
  type TemplateKey,
} from "../services/mailer.server";
import prisma from "../db.server";
import { requireBilling, reconcileShopPlan } from "../services/billing.server";
import { cancelPlan } from "../services/billing-actions.server";
import { NO_PER_ORDER_FEES_COPY } from "../lib/billing-v3";
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
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  CLAUDE_UNAVAILABLE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draft } from "../services/claude.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { SectionTabs } from "../components/SectionTabs";

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

  const creditEnabled = process.env.MANNON_FF_CREDIT === "true";
  const accountingEnabled = process.env.MANNON_FF_ACCOUNTING_SYNC === "true";
  const catalogsEnabled = process.env.MANNON_FF_CUSTOM_CATALOGS === "true";
  const repPortalEnabled = process.env.MANNON_FF_REP_PORTAL === "true";
  const flexPayEnabled = process.env.MANNON_FF_FLEX_PAY === "true";
  const taxVatEnabled = process.env.MANNON_FF_TAX_VAT === "true";
  const erpEnabled = process.env.MANNON_FF_ERP_SYNC === "true";
  const i18nEnabled = process.env.MANNON_FF_I18N === "true";
  const quoteWidgetEnabled = process.env.MANNON_FF_QUOTE_WIDGET === "true";
  const buyerPwaEnabled = process.env.MANNON_FF_BUYER_PWA === "true";
  const catalogShareEnabled = process.env.MANNON_FF_CATALOG_SHARE === "true";
  const whiteLabelEnabled = process.env.MANNON_FF_WHITE_LABEL === "true";

  const [quoteAllowance, seatAllowance, seats, templateOverrides, creditProfileCount, accountingConnCount, customCatalogCount, repCount, shopFlex, erpConnCount] =
    shopId
      ? await Promise.all([
          canCreateQuote(shopId),
          canAddSeat(shopId),
          listSeats(shopId),
          getEmailTemplates(session.shop),
          prisma.creditProfile.count({ where: { company: { shopId } } }),
          prisma.accountingConnection.count({ where: { shopId } }),
          prisma.catalog.count({ where: { shopId, isDefault: false } }),
          prisma.salesRep.count({ where: { shopId } }),
          prisma.shop.findUnique({ where: { id: shopId }, select: { defaultDepositPct: true, defaultTaxRate: true, supportedLocales: true, supportedCurrencies: true, quoteWidgetEnabled: true } }),
          prisma.erpConnection.count({ where: { shopId } }),
        ])
      : [null, null, [], {}, 0, 0, 0, 0, null, 0];

  const TEMPLATE_LABELS: Record<TemplateKey, string> = {
    invoice_issued: "Invoice issued",
    reminder_t_minus_3: "Reminder — 3 days before due",
    reminder_due: "Reminder — on due date",
    reminder_overdue_7: "Reminder — 7 days overdue",
    reorder_list: "Reorder a saved list",
    member_invite: "Team — member invite",
    approval_request: "Team — approval request",
    approval_decision: "Team — approval decision",
    application_received: "Wholesale — application received",
    application_decision: "Wholesale — application decision",
    application_notify: "Wholesale — new application (internal)",
    weekly_digest: "Analytics — weekly digest",
    followup_reminder: "Follow-up — reminder nudge",
    followup_expiry_warning: "Follow-up — expiry warning",
    followup_expired: "Follow-up — expired",
    accounting_sync_failure: "Accounting — sync failure digest",
    rep_invite: "Sales rep — invite",
    rep_order_placed: "Sales rep — order placed (buyer notice)",
    quote_request_created: "Widget — new request (merchant)",
    quote_request_ack: "Widget — request acknowledgement (visitor)",
    deposit_received: "Payments — deposit received",
    installment_due: "Payments — installment due",
    installment_overdue: "Payments — installment overdue",
    paylink: "Payments — pay-by-link",
    tax_certificate_received: "Tax — documents received",
    tax_verified: "Tax — verified",
    tax_rejected: "Tax — rejected",
    tax_cert_expiring: "Tax — certificate expiring",
    erp_sync_failure: "ERP — sync failure digest",
    pwa_install_nudge: "Buyer app — install nudge",
    catalog_lead_created: "Catalog sharing — new access request (merchant)",
    catalog_access_approved: "Catalog sharing — access approved (buyer)",
    org_invite: "Agency — workspace ready",
    store_linked: "Agency — store linked",
  };
  const templates = (Object.keys(DEFAULT_TEMPLATES) as TemplateKey[]).map((key) => {
    const t = resolveTemplate(key, templateOverrides);
    return { key, label: TEMPLATE_LABELS[key], subject: t.subject, body: t.body };
  });
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
    creditEnabled,
    hasCreditProfile: creditProfileCount > 0,
    accountingEnabled,
    hasAccountingConnection: accountingConnCount > 0,
    catalogsEnabled,
    hasCustomCatalog: customCatalogCount > 0,
    repPortalEnabled,
    hasRep: repCount > 0,
    flexPayEnabled,
    hasDepositPolicy: shopFlex?.defaultDepositPct != null,
    taxVatEnabled,
    hasTaxRules: shopFlex?.defaultTaxRate != null,
    erpEnabled,
    hasErpConnection: erpConnCount > 0,
    i18nEnabled,
    hasI18nSetup: ((shopFlex?.supportedLocales as string[] | null)?.length ?? 0) > 1 || ((shopFlex?.supportedCurrencies as string[] | null)?.length ?? 0) > 0,
    quoteWidgetEnabled,
    hasQuoteWidget: shopFlex?.quoteWidgetEnabled === true,
    buyerPwaEnabled,
    catalogShareEnabled,
    whiteLabelEnabled,
    templates,
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
  | { ok: true; kind: "template"; template: { key: string; subject: string; body: string } }
  | { ok: true; kind: "claude"; claudeEnabled: boolean; message: string }
  | { ok: false; kind: "settings" | "billing" | "seat" | "template" | "claude"; error: string; upgrade?: boolean };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save-settings");

  // --- F2 dual-mode: Claude drafts an email template's subject + body ---------
  if (intent === "ai-template") {
    const { access, shop } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return {
        ok: false,
        kind: "template",
        upgrade: true,
        error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY,
      } satisfies ActionResult;
    }
    const key = String(form.get("templateKey") ?? "");
    try {
      const { output } = await draft({
        feature: "email_template",
        shopId: shop.id,
        input: {
          label: String(form.get("label") ?? key),
          currentSubject: String(form.get("currentSubject") ?? ""),
          currentBody: String(form.get("currentBody") ?? ""),
        },
      });
      return {
        ok: true,
        kind: "template",
        template: {
          key,
          subject: typeof output.subject === "string" ? output.subject.trim() : "",
          body: typeof output.body === "string" ? output.body.trim() : "",
        },
      } satisfies ActionResult;
    } catch {
      return { ok: false, kind: "template", error: CLAUDE_UNAVAILABLE_COPY } satisfies ActionResult;
    }
  }

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

  if (intent === "billing-subscribe") {
    const plan = String(form.get("plan") ?? "");
    if (plan !== STARTER_PLAN && plan !== GROWTH_PLAN) {
      return { ok: false, kind: "billing", error: "Choose a valid plan." } satisfies ActionResult;
    }
    const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    // The return URL MUST carry the embedded context (shop + host). Without it,
    // Shopify's post-approval top-level redirect lands on the OAuth "enter your
    // store" page, the merchant never gets back into the embedded app, and the
    // new subscription is never reconciled (App Store review 1.2.3).
    const host = new URL(request.url).searchParams.get("host") ?? "";
    const back = new URLSearchParams({ shop: session.shop, embedded: "1" });
    if (host) back.set("host", host);
    await billing.request({ plan, isTest: IS_TEST, returnUrl: `${appUrl}/app/settings?${back.toString()}` });
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

  if (intent === "save-templates") {
    const keys: TemplateKey[] = [
      "invoice_issued",
      "reminder_t_minus_3",
      "reminder_due",
      "reminder_overdue_7",
      "reorder_list",
      "member_invite",
      "approval_request",
      "approval_decision",
      "application_received",
      "application_decision",
      "application_notify",
      "weekly_digest",
      "followup_reminder",
      "followup_expiry_warning",
      "followup_expired",
    ];
    const overrides: Record<string, { subject?: string; body?: string }> = {};
    for (const key of keys) {
      const subject = String(form.get(`tpl_${key}_subject`) ?? "").trim();
      const body = String(form.get(`tpl_${key}_body`) ?? "").trim();
      // Only store fields that differ from the default, so defaults keep flowing.
      const entry: { subject?: string; body?: string } = {};
      if (subject && subject !== DEFAULT_TEMPLATES[key].subject) entry.subject = subject;
      if (body && body !== DEFAULT_TEMPLATES[key].body) entry.body = body;
      if (entry.subject || entry.body) overrides[key] = entry;
    }
    await saveEmailTemplates(session.shop, overrides);
    return { ok: true, kind: "settings" } satisfies ActionResult;
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

function limitLine(quotes: number | null, seats: number) {
  const q = quotes === null ? "Unlimited quotes" : `Up to ${quotes} active quotes / mo`;
  return `${q} · ${seats} seat${seats === 1 ? "" : "s"}`;
}

function TemplateEditor({
  t,
  tpl,
  setTplField,
  access,
}: {
  t: { key: string; label: string };
  tpl: Record<string, string>;
  setTplField: (field: string, value: string) => void;
  access: ClaudeAccess;
}) {
  const fetcher = useFetcher<typeof action>();
  const drafting = fetcher.state !== "idle";
  const subjectKey = `${t.key}_subject`;
  const bodyKey = `${t.key}_body`;
  const d = fetcher.data;
  const draftT = d && d.ok && d.kind === "template" && d.template.key === t.key ? d.template : null;
  const err = d && !d.ok && d.kind === "template" ? d.error : null;

  return (
    <Box paddingBlockStart="200">
      <BlockStack gap="150">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">{t.label}</Text>
          {access.allowed && (
            <Button
              size="slim"
              disabled={drafting}
              loading={drafting}
              onClick={() =>
                fetcher.submit(
                  { intent: "ai-template", templateKey: t.key, label: t.label, currentSubject: tpl[subjectKey] ?? "", currentBody: tpl[bodyKey] ?? "" },
                  { method: "post" },
                )
              }
            >
              ✦ Draft with Claude
            </Button>
          )}
        </InlineStack>
        <TextField
          label="Subject"
          name={`tpl_${t.key}_subject`}
          value={tpl[subjectKey] ?? ""}
          onChange={(v) => setTplField(subjectKey, v)}
          autoComplete="off"
        />
        <TextField
          label="Body"
          name={`tpl_${t.key}_body`}
          value={tpl[bodyKey] ?? ""}
          onChange={(v) => setTplField(bodyKey, v)}
          autoComplete="off"
          multiline={4}
        />
        {err && <Banner tone="warning">{err}</Banner>}
        {draftT && (
          <Box background="bg-surface-secondary" borderRadius="200" padding="300">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">{draftT.subject}</Text>
              <Text as="p" variant="bodySm">{draftT.body}</Text>
              <InlineStack gap="200">
                <Button
                  size="slim"
                  variant="primary"
                  onClick={() => {
                    setTplField(subjectKey, draftT.subject);
                    setTplField(bodyKey, draftT.body);
                  }}
                >
                  Use this
                </Button>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Badge tone="info">✦ Drafted by Claude</Badge>
                <Text as="span" variant="bodySm">{DRAFTED_BY_CLAUDE_TRUST}</Text>
              </InlineStack>
            </BlockStack>
          </Box>
        )}
      </BlockStack>
    </Box>
  );
}

/**
 * Store-wide Claude on/off switch. Only rendered where the PLAN grants Claude
 * (included, or an active Starter trial) — a Free/locked shop sees the upgrade
 * nudge instead, never this. Flipping it persists `Shop.claudeEnabled`; when off,
 * every ✦ "Draft with Claude" control across the app hides and the server guard
 * blocks model calls, so the merchant stays fully in manual mode.
 */
function ClaudeToggleCard({ initialEnabled }: { initialEnabled: boolean }) {
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
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="info">✦ Claude</Badge>
          <Text as="h2" variant="headingMd">
            Draft with Claude
          </Text>
        </InlineStack>
        <Text as="p" tone="subdued" variant="bodySm">
          When on, Mannon adds a “✦ Draft with Claude” button to quotes, offers,
          follow-ups and email templates. Claude only pre-fills a draft for you to
          review — it never sends anything on its own. Turn it off to keep every
          screen fully manual.
        </Text>
        <Checkbox
          label="Use Claude to draft"
          helpText="Applies to this whole store. You can turn it back on any time."
          checked={enabled}
          disabled={saving}
          onChange={(next) =>
            fetcher.submit(
              { intent: "claude-toggle", claudeEnabled: String(next) },
              { method: "post" },
            )
          }
        />
        {err && <Banner tone="warning">{err}</Banner>}
        {ok && !err && (
          <Text as="span" variant="bodySm" tone="subdued">
            {ok}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
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
  const [minMargin, setMinMargin] = useState(String(data.minMarginPercent));
  const [defaultTerms, setDefaultTerms] = useState(String(data.defaultTermsDays));
  const [seatEmail, setSeatEmail] = useState("");
  const [tpl, setTpl] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      data.templates.flatMap((t) => [
        [`${t.key}_subject`, t.subject],
        [`${t.key}_body`, t.body],
      ]),
    ),
  );
  const setTplField = (field: string, value: string) =>
    setTpl((prev) => ({ ...prev, [field]: value }));

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
      <SectionTabs active="general" />
      <BlockStack gap="500">
        {data.upgradeTarget && !planMeets(data.plan, data.upgradeTarget) && (
          <Banner tone="warning" title={`That needs the ${data.upgradeTarget} plan`}>
            <p>Choose {data.upgradeTarget} below.</p>
          </Banner>
        )}
        {billingMessage && <Banner tone="success" title={billingMessage} />}

        {/* First-run checklist: set up credit */}
        {data.creditEnabled && !data.hasCreditProfile && (
          <Banner tone="info" title="Finish setting up: add your first credit profile">
            <p>
              Give a company a credit limit and net terms so orders on terms raise
              an invoice with a due date.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/credit">Set your first credit profile</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding: build your first custom catalog */}
        {data.catalogsEnabled && !data.hasCustomCatalog && (
          <Banner tone="info" title="Optional: build your first custom catalog">
            <p>
              Show each buyer only the products they’re allowed to see. Assign a
              catalog to a company and everything else stays hidden.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/catalogs">Build a custom catalog</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding: add currencies & languages */}
        {data.i18nEnabled && !data.hasI18nSetup && (
          <Banner tone="info" title="Optional: add currencies & languages">
            <p>
              Sell across borders — let buyers see the portal in their language
              (Arabic is full RTL) and prices in their currency, with FX locked per
              quote.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/i18n">Add currencies &amp; languages</Button>
            </Box>
          </Banner>
        )}

        {/* Recommended onboarding (high activation): add the storefront widget */}
        {data.quoteWidgetEnabled && !data.hasQuoteWidget && (
          <Banner tone="info" title="Recommended: add the Request-a-Quote button to your theme">
            <p>
              Turn any product page into a B2B lead source — no code. Enable the
              widget, then add the app block in your theme editor.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/quote-requests" variant="primary">Set up the widget</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding (Growth, agencies): connect your first client store */}
        {data.whiteLabelEnabled && data.plan === GROWTH_PLAN && (
          <Banner tone="info" title="Running client stores? Connect your first one">
            <p>
              Agency mode manages every client store from one place — cross-store rollups, quick
              switching, and per-store white-label branding on the buyer portal. Each managed store
              keeps its own Growth subscription.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/agency" variant="primary">Open Agency</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding (Growth): publish a shareable catalog */}
        {data.catalogShareEnabled && data.plan === GROWTH_PLAN && (
          <Banner tone="info" title="Optional: publish your first shareable catalog">
            <p>
              Turn a custom catalog into a branded public page new buyers can browse and
              request access to — prices stay hidden until you approve them. Approving a
              request provisions the buyer and unlocks their prices automatically.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/catalog-sharing" variant="primary">Publish a catalog</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding: invite buyers to install the app */}
        {data.buyerPwaEnabled && (
          <Banner tone="info" title="Optional: invite buyers to install the app">
            <p>
              Repeat buyers can add your wholesale portal to their phone’s home
              screen and reorder their usual in one tap. It’s automatic — the
              install prompt appears in their portal; you can also send an
              “install the app” email nudge from your reminder emails.
            </p>
          </Banner>
        )}

        {/* Recommended onboarding: set your tax rules */}
        {data.taxVatEnabled && !data.hasTaxRules && (
          <Banner tone="info" title="Recommended: set your tax rules">
            <p>
              Set a default tax rate (e.g. KSA 15%, UAE 5%), collect exemption
              certificates, and verify buyers so their quotes and invoices show the
              right tax. Mannon never computes tax — Shopify does.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/tax">Set your tax rules</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding (Growth): set a default deposit policy */}
        {data.flexPayEnabled && data.plan === GROWTH_PLAN && !data.hasDepositPolicy && (
          <Banner tone="info" title="Optional: set a default deposit policy">
            <p>
              Take a deposit up front on big orders — set a default % so it pre-fills
              when you create a payment plan. All capture runs through Shopify checkout.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/payments">Set a default deposit policy</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding (Growth): connect ERP */}
        {data.erpEnabled && data.plan === GROWTH_PLAN && !data.hasErpConnection && (
          <Banner tone="info" title="Optional: connect your ERP">
            <p>
              Keep stock accurate and export orders to your ERP/WMS (webhook, SFTP,
              NetSuite, or custom). Credentials are encrypted; sync failures never
              block a Shopify order.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/erp">Connect your ERP</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding (Growth): invite sales reps */}
        {data.repPortalEnabled && data.plan === GROWTH_PLAN && !data.hasRep && (
          <Banner tone="info" title="Optional: invite your sales reps">
            <p>
              Give your reps a scoped login to their assigned accounts so they can
              place and negotiate orders on behalf of buyers.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/reps">Invite your sales reps</Button>
            </Box>
          </Banner>
        )}

        {/* Optional onboarding (Growth): connect accounting */}
        {data.accountingEnabled && data.plan === GROWTH_PLAN && !data.hasAccountingConnection && (
          <Banner tone="info" title="Optional: connect your accounting">
            <p>
              Sync every net-terms invoice and payment to QuickBooks Online or Xero
              automatically — no re-keying. You can set this up any time.
            </p>
            <Box paddingBlockStart="200">
              <Button url="/app/accounting">Connect your accounting</Button>
            </Box>
          </Banner>
        )}

        {/* Plan & billing */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Plan &amp; billing
              </Text>
              <Badge tone={data.plan ? "success" : "attention"}>{planLabel}</Badge>
            </InlineStack>
            {/* Pricing v3 trust line — Mannon is a flat monthly fee, never a
                per-order commission (unlike the Make-an-Offer rivals). Single
                source of truth: NO_PER_ORDER_FEES_COPY (app/lib/billing-v3.ts). */}
            <Banner tone="success">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {NO_PER_ORDER_FEES_COPY}
              </Text>
            </Banner>
            <Text as="p" tone="subdued" variant="bodyMd">
              The core workflow — quote builder, buyer portal, net terms, AI Order
              Pad, and reorder — is on both plans. Plans differ by quote volume and
              team seats. The <b>AI Quote Assistant</b> (AI counter-offers) is a
              Growth-only feature.
            </Text>

            <BlockStack gap="150">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  AI Quote Assistant
                </Text>
                <Badge tone="info">Growth</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Upgrade to Growth to suggest AI counter-offers inside a quote.
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Credit limits, aging &amp; auto-reminders
                </Text>
                <Badge tone="info">Growth</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Starter includes net terms + due dates; Growth adds credit
                    control, the aging dashboard, reminders, and invoice PDFs.
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Price lists
                </Text>
                <Badge tone="info">3 on Starter · unlimited on Growth</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Growth adds unlimited lists, volume breaks, and CSV import.
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Order pad &amp; saved lists
                </Text>
                <Badge tone="info">3 lists on Starter · unlimited + CSV on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Company accounts &amp; approvals
                </Text>
                <Badge tone="info">1 buyer on Starter · 5 members + approvals on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Wholesale sign-up forms
                </Text>
                <Badge tone="info">1 form · manual on Starter · multi-form + auto-approve on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Quote analytics
                </Text>
                <Badge tone="info">Growth</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Win rate, avg discount, time-to-close, and pipeline.
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Auto follow-ups &amp; expiry
                </Text>
                <Badge tone="info">1 reminder on Starter · full cadence on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Order minimums &amp; pack rules
                </Text>
                <Badge tone="info">Store + product on Starter · groups + packs + CSV on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  QuickBooks &amp; Xero accounting sync
                </Text>
                <Badge tone="info">Growth</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Push invoices + payments to your accounting provider — no re-keying.
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Custom catalogs
                </Text>
                <Badge tone="info">1 on Starter · unlimited + group/member + CSV on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Sales-rep portal
                </Text>
                <Badge tone="info">Growth · up to 3 rep seats</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Reps order &amp; negotiate on behalf of buyers, scoped to their accounts.
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Flexible payments
                </Text>
                <Badge tone="info">Growth</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Deposits, installments &amp; pay-by-link — all via Shopify checkout.
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Tax exemption &amp; VAT/GST
                </Text>
                <Badge tone="info">Basic on Starter · regions + certificates on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  ERP &amp; inventory sync
                </Text>
                <Badge tone="info">Growth</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Real-time stock in, orders out (webhook / SFTP / NetSuite).
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Multi-currency &amp; language (Arabic/RTL)
                </Text>
                <Badge tone="info">1 extra currency + EN/AR on Starter · unlimited + contract rates on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Storefront “Request a Quote” widget
                </Text>
                <Badge tone="info">PDP form on Starter · cart + gated + custom fields on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Installable buyer app &amp; one-tap reorder
                </Text>
                <Badge tone="info">Install + one-tap reorder on Starter · push reminders + saved bundles on Growth</Badge>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Shareable catalog &amp; B2B discovery
                </Text>
                <Badge tone="info">Growth</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Publish a public wholesale catalog and capture new buyers — prices stay
                    protected until you approve access.
                  </Text>
                )}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  Agency mode &amp; white-label (multi-store)
                </Text>
                <Badge tone="info">Growth · Agency add-on</Badge>
                {data.plan !== GROWTH_PLAN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Manage &amp; white-label multiple stores from one place. Each managed store keeps
                    its own Growth subscription — the org view is management-only.
                  </Text>
                )}
              </InlineStack>
            </BlockStack>

            {/* The plan picker moved to its own top-level page (NAV-MIGRATION.md)
                and now shows the full 4-plan ladder (Free/Starter/Growth/Scale)
                that the App Store listing advertises — see /app/plans. */}
            <Box background="bg-surface-secondary" borderRadius="200" padding="400">
              <InlineStack align="space-between" blockAlign="center" wrap gap="300">
                <Text as="p" variant="bodyMd">
                  Compare all four plans — Free, Starter, Growth and Scale — and
                  upgrade or downgrade any time.
                </Text>
                <Button variant="primary" url="/app/plans">
                  View pricing plans
                </Button>
              </InlineStack>
            </Box>

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
              <TextField
                label="AI floor margin (%)"
                type="number"
                name="minMarginPercent"
                value={minMargin}
                onChange={setMinMargin}
                min={0}
                max={95}
                suffix="%"
                autoComplete="off"
                helpText="The AI Quote Assistant never knowingly suggests a counter-offer below this margin. Suggestions that would breach it are flagged and can’t be accepted in one click."
              />
              <Select
                label="Default net terms"
                name="defaultTermsDays"
                options={data.termDaysOptions.map((t) => ({
                  label: `Net ${t}`,
                  value: String(t),
                }))}
                value={defaultTerms}
                onChange={setDefaultTerms}
                helpText="Used to set an invoice's due date when a net-terms order checks out, unless the company has its own credit profile terms."
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

        {/* Store-wide Claude on/off — only where the plan grants Claude. */}
        {data.access.planGrantsClaude && (
          <ClaudeToggleCard initialEnabled={data.claudeEnabled} />
        )}

        {/* Email templates (F2) — edit the invoice + reminder copy. */}
        {data.creditEnabled && (
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="save-templates" />
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Invoice &amp; reminder emails
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Edit the copy sent for invoices and the T-3 / due / overdue
                  reminders. Use {"{{invoiceNumber}}"}, {"{{amount}}"},{" "}
                  {"{{dueDate}}"}, {"{{buyerName}}"}, {"{{invoiceUrl}}"}. Leave a
                  field as-is to keep the default.
                </Text>
                {data.access.state === "trial" && data.access.daysLeft != null && (
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="attention">{`Claude trial · ${data.access.daysLeft} ${data.access.daysLeft === 1 ? "day" : "days"} left`}</Badge>
                  </InlineStack>
                )}
                {!data.access.allowed && <UpgradeToClaude access={data.access as ClaudeAccess} upgradeUrl="/app/settings" />}
                {data.templates.map((t) => (
                  <TemplateEditor key={t.key} t={t} tpl={tpl} setTplField={setTplField} access={data.access as ClaudeAccess} />
                ))}
                <Button variant="primary" submit loading={submitting}>
                  Save email templates
                </Button>
              </BlockStack>
            </Form>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
