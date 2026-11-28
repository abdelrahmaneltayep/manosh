import { useEffect, useMemo, useState } from "react";
import { storeSender } from "../services/store-sender.server";
import { shopNameFor } from "../services/shop-name.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  TextField,
  Select,
  Button,
  Banner,
  Box,
  Divider,
  Spinner,
  SkeletonBodyText,
  Layout,
  Modal,
  Link as PolarisLink,
} from "@shopify/polaris";
import { DisclosureCard } from "../components/DisclosureCard";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  declineQuoteForShop,
  getQuoteDetailForShop,
  parseCounterForm,
} from "../services/quote-inbox.server";
import {
  IllegalQuoteTransitionError,
  QuoteNotFoundError,
} from "../services/quote.server";
import { requireBilling } from "../services/billing.server";
import { featureAccess, STARTER_PLAN } from "../lib/billing";
import prisma from "../db.server";
import {
  claudeAccess,
  CLAUDE_TRIAL_ENDED_COPY,
  CLAUDE_UPGRADE_COPY,
  CLAUDE_UNAVAILABLE_COPY,
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { appendAiEvent } from "../services/claude.server";
import { draftUpsellBundle } from "../services/insights-ai.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { DraftedByClaude } from "../components/DraftedByClaude";
import { convertQuoteToOrder, QuoteConvertError } from "../services/quote-convert.server";
import { DraftOrderError, getDraftOrderStatus, sendDraftOrderInvoice, type DraftOrderStatusView } from "../services/draft-order.server";
import { issueBuyerQuoteLink } from "../services/buyer-sign-in-link.server";
import { replyLockFor } from "../services/plan-limits.server";
import { emailQuoteSent } from "../services/quote-emails.server";
import { emailCopy } from "../lib/email-delivery";
import { useEmailDelivery } from "../lib/use-email-delivery";
import { CopyPanel } from "../components/CopyPanel";
import { renderQuotePdf } from "../services/quote-pdf.server";
import { duplicateQuote, QuoteNotFoundForShopError } from "../services/quote-duplicate.server";
import { emailDeliveryEnabled, lastDeliveryFor, sendEmail } from "../services/mailer.server";
import { appendEvent } from "../services/events.server";
import { getCatalog } from "../services/catalog.server";
import { quoteTimelineSources, saveInternalNote, sendQuoteForShop } from "../services/quote-send.server";
import { buildTimeline } from "../lib/quote-timeline";
import { parseAdjustments, readAdjustments, sendBlockedReason, sendLabel, type QuoteAdjustments } from "../lib/quote-adjustments";
import { QUOTE_OPS_ENABLED } from "../lib/quote-ops";
import {
  generateSuggestionForLine,
  generateSuggestionsForQuote,
  getLatestSuggestions,
  AiRateLimitedError,
  QuoteLineNotFoundError,
  type SuggestionView,
} from "../services/quote-ai.server";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate, formatDateTime, formatMoney } from "../lib/format";
import type { loader as totalsLoader } from "./app.quote-totals.$id";
import { upgradeUrl } from "../lib/upgrade";
import { TEMPLATE_INFO } from "../lib/notification-templates";

const IS_TEST = process.env.NODE_ENV !== "production";
// Dark-launch flag for Feature 1. AI UI + action are inert unless this is on.
const AI_QUOTE_ENABLED = () => process.env.MANNON_FF_AI_QUOTE === "true";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const quote = await getQuoteDetailForShop(session.shop, params.id!);
  if (!quote) {
    throw new Response("Quote not found", { status: 404 });
  }

  const aiEnabled = AI_QUOTE_ENABLED();
  // Past a capped plan's quote limit the request is saved but can't be answered
  // until the merchant upgrades (plan-limits.server.ts canReplyToQuote).
  const replyLock = await replyLockFor(session.shop, quote.id);
  // The last email Mannon tried to send about this quote, so a failure shows here.
  const shopRow = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop }, select: { id: true } });
  const lastEmail = shopRow ? await lastDeliveryFor(shopRow.id, "Quote", quote.id) : null;
  const timelineSources = shopRow ? await quoteTimelineSources(shopRow.id, quote.id) : { events: [], emails: [] };
  // An ordered quote: Shopify's own draft-order and payment status.
  let draftOrder: DraftOrderStatusView | null = null;
  let draftOrderUnavailable = false;
  if (quote.draftOrderId) {
    try {
      draftOrder = await getDraftOrderStatus(admin, quote.draftOrderId);
      if (!draftOrder) draftOrderUnavailable = true;
    } catch {
      draftOrderUnavailable = true;
    }
  }
  const timeline = buildTimeline(timelineSources.events, timelineSources.emails);
  if (draftOrder?.invoiceSentAt) {
    timeline.unshift({ at: new Date(draftOrder.invoiceSentAt).toISOString(), text: "Invoice sent by Shopify" });
    timeline.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
  // Dual-mode gating: Growth/Scale included, Starter on a one-time 7-day trial,
  // Free/expired locked. Read-only here — the trial is only *started* in the
  // action, on first real use (never on a page view).
  let access: ClaudeAccess = claudeAccess({ plan: "FREE" }, new Date());
  if (aiEnabled) {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
    });
    if (shop) access = claudeAccess(shop, new Date());
  }

  // Latest suggestion per line (cached view) — only when the feature is on.
  const suggestionsByLine = aiEnabled ? await getLatestSuggestions(quote.id) : new Map();
  const suggestions: Record<string, SuggestionView> = {};
  for (const [key, view] of suggestionsByLine) {
    if (key !== "__quote__") suggestions[key] = view;
  }

  return {
    aiEnabled,
    access,
    quoteOpsEnabled: QUOTE_OPS_ENABLED(),
    replyLock,
    lastEmail: lastEmail
      ? { ...lastEmail, label: TEMPLATE_INFO[lastEmail.template ?? ""]?.label ?? "Email", createdAt: lastEmail.createdAt.toISOString() }
      : null,
    suggestions,
    timeline,
    draftOrder,
    draftOrderUnavailable,
    // Buyers can't make their own offer on a quote yet, so the reply is "Send quote".
    sendLabel: sendLabel({ buyerOffered: false }),
    sendBlocked: sendBlockedReason({ status: quote.status, expiresAt: quote.expiresAt }),
    quote: {
      id: quote.id,
      adjustments: readAdjustments(quote.adjustments),
      buyerMessage: quote.buyerMessage,
      internalNote: quote.internalNote,
      status: quote.status,
      companyName: quote.company.name,
      buyerEmail: quote.buyer.email,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      poReference: quote.poReference,
      draftOrderId: quote.draftOrderId,
      convertedOrderId: quote.convertedOrderId,
      lines: quote.lines.map((line) => ({
        id: line.id,
        title: line.title,
        sku: line.sku,
        quantity: line.quantity,
        price: line.price.toString(),
      })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const quoteId = params.id!;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // F25 Quote Ops (convert / PDF email / duplicate) is dark-launched behind its flag.
  if ((intent === "convert" || intent === "pdf-email" || intent === "duplicate") && !QUOTE_OPS_ENABLED()) {
    throw new Response("Not found", { status: 404 });
  }

  // --- Buyer link: the merchant copies a sign-in link that lands on this quote.
  // Offered while no email sender is connected, so nothing promises a send.
  if (intent === "buyer-link") {
    const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
    const link = await issueBuyerQuoteLink(session.shop, quoteId, baseUrl);
    if (!link) return { ok: false as const, kind: "quote" as const, error: "Quote not found." };
    return {
      ok: true as const,
      kind: "quote" as const,
      message: "",
      buyerLink: { url: link.url, email: link.buyerEmail, expiresAt: link.expiresAt.toISOString() },
    };
  }

  // --- F25.1 email the branded quote PDF to the buyer (paid) -----------------
  if (intent === "pdf-email") {
    if (!emailDeliveryEnabled()) {
      return { ok: false as const, kind: "quote" as const, error: "Mannon isn’t connected to a sender yet. Use Copy buyer link instead." };
    }
    const status = await requireBilling(billing, { isTest: IS_TEST });
    if (!featureAccess(status, STARTER_PLAN).allowed) {
      return { ok: false as const, kind: "quote" as const, error: "Emailing the quote PDF needs a paid plan.", upgrade: true as const };
    }
    const catalog = await getCatalog(session.shop);
    const currencyCode = catalog[0]?.currencyCode ?? "USD";
    const pdf = await renderQuotePdf(session.shop, quoteId, { currencyCode, plan: status.plan });
    if (!pdf) return { ok: false as const, kind: "quote" as const, error: "Quote not found." };
    const sent = await sendEmail({ ...(await storeSender(session.shop)),
      to: pdf.buyerEmail,
      subject: "Your quote",
      html: "<p>Your quote is attached as a PDF.</p>",
      text: "Your quote is attached as a PDF.",
      attachments: [{ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }],
      tag: "quote_pdf",
    }, { shopId: pdf.shopId, template: "quote_pdf", entityType: "Quote", entityId: quoteId });
    // Only claim a send that happened.
    if (!sent.sent) {
      return { ok: false as const, kind: "quote" as const, error: "The quote PDF couldn’t be emailed. Use Copy buyer link or Download PDF and send it yourself." };
    }
    await appendEvent({ shopId: pdf.shopId, type: "QUOTE_PDF_GENERATED", entityType: "Quote", entityId: quoteId, payload: { via: "email" } });
    return { ok: true as const, kind: "quote" as const, message: "Quote PDF emailed to the buyer." };
  }

  // --- F25.4 duplicate ("create a similar quote", paid) ---------------------
  if (intent === "duplicate") {
    const status = await requireBilling(billing, { isTest: IS_TEST });
    if (!featureAccess(status, STARTER_PLAN).allowed) {
      return { ok: false as const, kind: "quote" as const, error: "Duplicating a quote needs a paid plan.", upgrade: true as const };
    }
    try {
      const { quoteId: newId } = await duplicateQuote(session.shop, quoteId);
      return redirect(`/app/quotes/${newId}`);
    } catch (error) {
      if (error instanceof QuoteNotFoundForShopError) throw new Response("Quote not found", { status: 404 });
      throw error;
    }
  }

  // --- F25.2 convert quote → draft order → invoice (paid) -------------------
  if (intent === "counter" || intent === "convert") {
    const lock = await replyLockFor(session.shop, quoteId);
    if (lock) return { ok: false as const, kind: "quote" as const, error: lock.message, upgrade: true as const };
  }

  if (intent === "convert") {
    const status = await requireBilling(billing, { isTest: IS_TEST });
    if (!featureAccess(status, STARTER_PLAN).allowed) {
      return { ok: false as const, kind: "quote" as const, error: "Converting to an order needs a paid plan.", upgrade: true as const };
    }
    try {
      const catalog = await getCatalog(session.shop);
      const currencyCode = catalog[0]?.currencyCode ?? "USD";
      const res = await convertQuoteToOrder(quoteId, admin, { currencyCode });
      return { ok: true as const, kind: "quote" as const, message: res.invoiceSent ? "Draft order created and invoice sent." : "Draft order created." };
    } catch (error) {
      if (error instanceof QuoteConvertError || error instanceof DraftOrderError) {
        return { ok: false as const, kind: "quote" as const, error: error.message };
      }
      throw error;
    }
  }

  // --- AI-14 upsell bundle — Claude suggests complementary items from the
  // catalog; the merchant reviews and adds them via the normal editor. Dual-mode:
  // suggestions only, nothing is added to the quote by Claude.
  if (intent === "ai-upsell") {
    if (!AI_QUOTE_ENABLED()) {
      return { ok: false as const, kind: "upsell" as const, error: "This feature isn’t available." };
    }
    const { access } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return {
        ok: false as const,
        kind: "upsell" as const,
        error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY,
        upgrade: true as const,
      };
    }
    try {
      const suggestions = await draftUpsellBundle(session.shop, quoteId);
      if (suggestions == null) return { ok: false as const, kind: "upsell" as const, error: "Quote not found." };
      return { ok: true as const, kind: "upsell" as const, suggestions };
    } catch {
      return { ok: false as const, kind: "upsell" as const, error: CLAUDE_UNAVAILABLE_COPY };
    }
  }

  // --- F1 AI Quote Assistant, dual-mode (Claude drafts, merchant confirms) ---
  if (intent === "ai-suggest" || intent === "ai-suggest-all") {
    if (!AI_QUOTE_ENABLED()) {
      return { ok: false as const, kind: "ai" as const, error: "This feature isn’t available." };
    }
    // Dual-mode gate: included on Growth/Scale; Starter's one-time 7-day trial
    // *starts here* on first real use; Free/expired are locked. Claude only
    // pre-fills the counter — the merchant still clicks Send (guardrail #4).
    const { access, shop } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
    if (!access.allowed) {
      return {
        ok: false as const,
        kind: "ai" as const,
        error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY,
        upgrade: true as const,
      };
    }
    try {
      if (intent === "ai-suggest-all") {
        await generateSuggestionsForQuote(session.shop, quoteId);
      } else {
        await generateSuggestionForLine(session.shop, quoteId, String(form.get("lineId") ?? ""));
      }
      // Append-only dual-mode analytics (feature adoption / cost).
      await appendAiEvent({ shopId: shop.id, feature: "quote_counter" });
      return { ok: true as const, kind: "ai" as const };
    } catch (error) {
      if (error instanceof AiRateLimitedError) {
        return { ok: false as const, kind: "ai" as const, error: error.message };
      }
      if (error instanceof QuoteLineNotFoundError) {
        return { ok: false as const, kind: "ai" as const, error: "That line is no longer on this quote." };
      }
      return {
        ok: false as const,
        kind: "ai" as const,
        error: "Couldn’t get an AI suggestion right now. Please try again.",
      };
    }
  }

  // The one action on an ordered quote: Shopify emails the buyer its invoice.
  if (intent === "send-invoice") {
    const owned = await prisma.quote.findFirst({
      where: { id: quoteId, company: { shop: { shopifyDomain: session.shop } } },
      select: { draftOrderId: true },
    });
    if (!owned?.draftOrderId) return { ok: false as const, kind: "quote" as const, error: "This quote doesn’t have a draft order yet." };
    try {
      await sendDraftOrderInvoice(admin, owned.draftOrderId);
      return { ok: true as const, kind: "quote" as const, message: "Shopify sent the invoice to the buyer." };
    } catch (error) {
      return {
        ok: false as const,
        kind: "quote" as const,
        error:
          error instanceof DraftOrderError
            ? `Shopify didn’t send the invoice: ${error.message.replace(/^draftOrderInvoiceSend failed: /, "")}`
            : "Shopify couldn’t be reached, so the invoice wasn’t sent. Try again in a moment.",
      };
    }
  }

  if (intent === "note") {
    const saved = await saveInternalNote(session.shop, quoteId, String(form.get("internalNote") ?? ""));
    return saved
      ? { ok: true as const, kind: "note" as const, message: "Note saved." }
      : { ok: false as const, kind: "note" as const, error: "This quote couldn’t be found." };
  }

  try {
    if (intent === "decline") {
      await declineQuoteForShop(session.shop, quoteId);
      return { ok: true as const, kind: "quote" as const, message: "Quote declined." };
    }

    if (intent === "counter") {
      const parsed = parseCounterForm(form);
      if (!parsed.ok) {
        return { ok: false as const, kind: "quote" as const, error: parsed.error };
      }
      const adjusted = parseAdjustments(form);
      if (!adjusted.ok) {
        return { ok: false as const, kind: "quote" as const, error: adjusted.error };
      }
      // Shopify recalculates the totals for exactly what's being sent; if it
      // can't, nothing is saved or sent.
      const catalog = await getCatalog(session.shop);
      const sent = await sendQuoteForShop({
        shopDomain: session.shop,
        quoteId,
        admin,
        currencyCode: catalog[0]?.currencyCode ?? "USD",
        lines: parsed.lines,
        adjustments: adjusted.adjustments,
        buyerMessage: String(form.get("buyerMessage") ?? "").trim().slice(0, 2000) || null,
      });
      if (!sent.ok) {
        if (sent.reason === "not-found") throw new Response("Quote not found", { status: 404 });
        return { ok: false as const, kind: "quote" as const, error: sent.error };
      }
      // Email the buyer the quote with a sign-in link. When it doesn't go out
      // (no sender connected, or the send failed) the merchant gets the link
      // to copy, and a failure is said plainly.
      const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
      const emailed = await emailQuoteSent(quoteId, baseUrl);
      if (emailed?.result.sent) {
        return { ok: true as const, kind: "quote" as const, message: `Quote sent to ${emailed.to}.` };
      }
      const link = emailed?.link ?? null;
      const failed = emailed?.result.error;
      return {
        ok: true as const,
        kind: "quote" as const,
        message: failed
          ? `Counter saved, but the email to ${emailed?.to} wasn’t delivered (${failed.replace(/[.\s]+$/, "")}). Copy the buyer’s link below and send it yourself.`
          : "Counter saved. No email was sent: copy the buyer’s link below and send it to them.",
        buyerLink: link && emailed ? { url: link.url, email: emailed.to, expiresAt: link.expiresAt } : undefined,
      };
    }

    return { ok: false as const, kind: "quote" as const, error: "Unknown action." };
  } catch (error) {
    if (error instanceof QuoteNotFoundError) {
      throw new Response("Quote not found", { status: 404 });
    }
    if (error instanceof IllegalQuoteTransitionError) {
      return {
        ok: false as const,
        kind: "quote" as const,
        error:
          intent === "decline"
            ? "This quote can no longer be declined."
            : "This quote can no longer be countered — it may have been accepted or expired.",
      };
    }
    throw error;
  }
};

/** Trim a stored Decimal string ("12.5000") to a clean input value ("12.5"). */
function cleanPrice(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}
function money(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

function UpsellBundle({ quoteId }: { quoteId: string }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const d = fetcher.data;
  const res = d && d.ok && "kind" in d && d.kind === "upsell" ? d : null;
  const err = d && !d.ok && "kind" in d && d.kind === "upsell" ? d.error : null;
  return (
    <BlockStack gap="300">
        <InlineStack gap="200">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="ai-upsell" />
            <Button submit size="slim" disabled={busy} loading={busy}>
              ✦ Suggest add-ons with Claude
            </Button>
          </fetcher.Form>
        </InlineStack>
        {err && <Banner tone="warning">{err}</Banner>}
        {res && res.suggestions.length === 0 && (
          <Text as="p" tone="subdued" variant="bodySm">
            Claude didn’t find a good complementary item in your catalog for this quote.
          </Text>
        )}
        {res && res.suggestions.length > 0 && (
          <DraftedByClaude>
            <BlockStack gap="200">
              {res.suggestions.map((s) => (
                <InlineStack key={s.sku} align="space-between" blockAlign="center" wrap gap="200">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {s.title}{" "}
                    <Text as="span" tone="subdued" variant="bodySm">({s.sku})</Text>
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">{s.reason}</Text>
                </InlineStack>
              ))}
              <Text as="p" tone="subdued" variant="bodySm">
                Add any of these from the editor — Claude only suggests, you decide.
              </Text>
            </BlockStack>
          </DraftedByClaude>
        )}
    </BlockStack>
  );
}

export default function QuoteDetail() {
  const { quote, aiEnabled, access, quoteOpsEnabled, suggestions, replyLock, lastEmail, timeline, sendLabel: sendText, sendBlocked, draftOrder, draftOrderUnavailable } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const aiFetcher = useFetcher<typeof action>();
  const submitting = navigation.state === "submitting";

  const badge = quoteStatusBadge(quote.status);
  const isSubmitted = quote.status === "SUBMITTED";
  const isTerminal = quote.status === "ORDERED" || quote.status === "EXPIRED";

  const [lines, setLines] = useState(() =>
    quote.lines.map((line) => ({
      ...line,
      priceInput: cleanPrice(line.price),
      quantityInput: String(line.quantity),
    })),
  );
  // Locally dismissed suggestions (client-only; the row stays cached in the DB).
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const setLine = (id: string, field: "priceInput" | "quantityInput", value: string) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));

  // Draft-order layout: discount, shipping, custom items and the buyer message,
  // typed here and sent with the quote. Shopify calculates every amount.
  const stored = quote.adjustments as QuoteAdjustments;
  const [discount, setDiscount] = useState(() => ({
    open: Boolean(stored.discount),
    type: stored.discount?.valueType ?? "PERCENTAGE",
    value: stored.discount?.value ?? "",
    title: stored.discount?.title ?? "",
  }));
  const [shipping, setShipping] = useState(() => ({
    open: Boolean(stored.shipping),
    title: stored.shipping?.title ?? "Shipping",
    price: stored.shipping?.price ?? "",
  }));
  const [customItems, setCustomItems] = useState(() =>
    stored.customItems.map((c, i) => ({ key: i, title: c.title, quantity: String(c.quantity), price: c.price })),
  );
  const [buyerMessage, setBuyerMessage] = useState(quote.buyerMessage ?? "");
  const nextKey = () => customItems.reduce((m, c) => Math.max(m, c.key), -1) + 1;
  const setCustom = (key: number, field: "title" | "quantity" | "price", value: string) =>
    setCustomItems((prev) => prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)));
  /** The form fields Shopify prices and Send submits (same names as the parsers). */
  const quoteFields = (): Array<[string, string]> => {
    const f: Array<[string, string]> = [];
    for (const l of lines) {
      f.push(["lineId", l.id], [`price_${l.id}`, l.priceInput], [`quantity_${l.id}`, l.quantityInput]);
    }
    if (discount.open && discount.value.trim()) {
      f.push(["discountType", discount.type], ["discountValue", discount.value], ["discountTitle", discount.title]);
    }
    if (shipping.open) f.push(["shippingTitle", shipping.title], ["shippingPrice", shipping.price]);
    customItems.forEach((c, i) => f.push([`customTitle_${i}`, c.title], [`customQuantity_${i}`, c.quantity], [`customPrice_${i}`, c.price]));
    return f;
  };
  const sendQuote = () => {
    const fd = new FormData();
    fd.set("intent", "counter");
    for (const [k, v] of quoteFields()) fd.append(k, v);
    fd.set("buyerMessage", buyerMessage);
    submit(fd, { method: "post" });
  };
  const noteFetcher = useFetcher<typeof action>();
  const [note, setNote] = useState(quote.internalNote ?? "");

  const quoteAction = actionData?.kind === "quote" ? actionData : null;
  const aiActionError =
    actionData?.kind === "ai" && !actionData.ok ? actionData.error : null;

  const generatingLineId =
    aiFetcher.state !== "idle" ? String(aiFetcher.formData?.get("lineId") ?? "") : null;
  const generatingAll =
    aiFetcher.state !== "idle" && aiFetcher.formData?.get("intent") === "ai-suggest-all";
  const aiFetcherError =
    aiFetcher.data && aiFetcher.data.kind === "ai" && !aiFetcher.data.ok
      ? aiFetcher.data.error
      : null;

  const hasAnySuggestion = Object.keys(suggestions).length > 0;
  const showAi = aiEnabled && isSubmitted;
  const countered = quote.status === "COUNTERED";

  // Page-level actions (App Home details pattern): one primary action for the
  // next step, document actions as secondary, Decline behind a confirm dialog.
  const submit = useSubmit();
  const [confirmDecline, setConfirmDecline] = useState(false);
  const post = (intent: string) => {
    const fd = new FormData();
    fd.set("intent", intent);
    submit(fd, { method: "post" });
  };
  const canConvert =
    quoteOpsEnabled &&
    (quote.status === "ACCEPTED" || quote.status === "COUNTERED") &&
    !quote.draftOrderId &&
    !quote.convertedOrderId;
  // Ordered: one action, Shopify emails the buyer its invoice (until paid).
  const canSendInvoice = Boolean(quote.draftOrderId) && draftOrder?.status !== "COMPLETED" && !draftOrderUnavailable;
  const payment = paymentStatus(draftOrder);
  const orderGid = quote.draftOrderId || quote.convertedOrderId || null;
  const orderNumericId = orderGid ? String(orderGid).split("/").pop() : null;
  const orderUrl = orderGid
    ? String(orderGid).includes("/Order/")
      ? `shopify://admin/orders/${orderNumericId}`
      : `shopify://admin/draft_orders/${orderNumericId}`
    : null;
  // While no sender is connected, the email action becomes "Copy buyer link"
  // (always available: a sign-in link needs no paid plan).
  const emailDelivery = useEmailDelivery();
  const copy = emailCopy(emailDelivery);
  const buyerLink =
    (quoteAction && quoteAction.ok
      ? (quoteAction as { buyerLink?: { url: string; email: string; expiresAt: string } }).buyerLink
      : null) ?? null;
  const secondaryActions = [
    ...(quoteOpsEnabled
      ? [{ content: "Download PDF", url: `/app/quotes/${quote.id}.pdf`, target: "_blank" as const }]
      : []),
    ...(emailDelivery
      ? quoteOpsEnabled
        ? [{ content: copy.quotePdfAction, onAction: () => post("pdf-email"), disabled: submitting }]
        : []
      : [{ content: copy.quotePdfAction, onAction: () => post("buyer-link"), disabled: submitting }]),
    ...(quoteOpsEnabled
      ? [{ content: "Duplicate quote", onAction: () => post("duplicate"), disabled: submitting }]
      : []),
    ...(!isTerminal
      ? [{ content: "Decline quote", destructive: true, onAction: () => setConfirmDecline(true), disabled: submitting }]
      : []),
  ];

  return (
    <Page
      backAction={{ content: "Quotes", url: "/app/quotes" }}
      title={quote.companyName}
      titleMetadata={<Badge tone={badge.tone}>{badge.label}</Badge>}
      subtitle={quote.buyerEmail}
      primaryAction={
        canConvert
          ? { content: "Convert to order", onAction: () => post("convert"), loading: submitting }
          : canSendInvoice
            ? { content: "Send invoice", onAction: () => post("send-invoice"), loading: submitting && navigation.formData?.get("intent") === "send-invoice" }
            : undefined
      }
      secondaryActions={secondaryActions}
    >
      <TitleBar title={quote.companyName} />
      <Modal
        open={confirmDecline}
        onClose={() => setConfirmDecline(false)}
        title="Decline this quote?"
        primaryAction={{
          content: "Decline quote",
          destructive: true,
          loading: submitting,
          onAction: () => {
            setConfirmDecline(false);
            post("decline");
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmDecline(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            {emailDelivery
              ? "The buyer is told you can’t quote this order and the quote closes. This can’t be undone."
              : "The quote closes and the buyer sees that in their portal. Mannon doesn’t notify them, so tell them yourself. This can’t be undone."}
          </Text>
        </Modal.Section>
      </Modal>
      <BlockStack gap="400">
        {quoteAction && !quoteAction.ok && (
          <Banner tone="critical" title="Couldn’t update this quote">
            <p>{quoteAction.error}</p>
          </Banner>
        )}
        {quoteAction && quoteAction.ok && quoteAction.message && <Banner tone="success" title={quoteAction.message} />}
        {lastEmail && lastEmail.status === "FAILED" && !buyerLink && (
          <Banner
            tone="warning"
            title={`The last email to ${lastEmail.to} wasn’t delivered`}
            action={{ content: "Copy buyer link", onAction: () => post("buyer-link") }}
          >
            <p>{`${lastEmail.label}: ${(lastEmail.error ?? "the email provider refused it").replace(/[.\s]+$/, "")}. Copy the buyer’s sign-in link and send it yourself.`}</p>
          </Banner>
        )}
        {replyLock && (
          <Banner tone="warning" title="Upgrade to reply to this quote" action={{ content: "See plans", url: upgradeUrl(replyLock.upgradeTo) }}>
            <p>{replyLock.message}</p>
          </Banner>
        )}
        {buyerLink && (
          <CopyPanel
            title="Buyer link ready"
            description={`Share this with ${buyerLink.email}. It signs them in and opens this quote. It works once, expires ${formatDate(buyerLink.expiresAt)}. Links you made earlier keep working.`}
            text={buyerLink.url}
            toast="Buyer link copied"
            copyLabel="Copy link"
          />
        )}
        {(aiActionError || aiFetcherError) && (
          <Banner tone="warning" title="Draft with Claude">
            <p>{aiActionError || aiFetcherError}</p>
          </Banner>
        )}
        {orderUrl && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <Text as="h2" variant="headingMd">
                  Order
                </Text>
                {payment && <Badge tone={payment.tone}>{payment.label}</Badge>}
              </InlineStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="p">{draftOrder ? `Draft order ${draftOrder.name}${draftOrder.order ? ` · Order ${draftOrder.order.name}` : ""}` : "Draft order in Shopify"}</Text>
                <PolarisLink url={draftOrder?.order ? `shopify://admin/orders/${draftOrder.order.id.split("/").pop()}` : orderUrl}>Open in Shopify</PolarisLink>
              </InlineStack>
              <Text as="p" tone="subdued">
                {draftOrderUnavailable
                  ? "Shopify’s payment status isn’t available right now. Open the order in Shopify to check it."
                  : payment?.detail}
              </Text>
            </BlockStack>
          </Card>
        )}

        <Layout>
          {/* Primary column: what the quote IS — the lines and Shopify's totals. */}
          <Layout.Section>
            <BlockStack gap="400">
              {showAi && !access.allowed && (
                <UpgradeToClaude access={access} upgradeUrl={upgradeUrl("growth")} />
              )}

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center" wrap gap="200">
                    <Text as="h2" variant="headingMd">
                      {isSubmitted ? "Price this quote" : "Items"}
                    </Text>
                    {showAi && access.state === "trial" && access.daysLeft != null && (
                      <Badge tone="attention">
                        {`Claude trial · ${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left`}
                      </Badge>
                    )}
                  </InlineStack>
                  {showAi && access.allowed && !hasAnySuggestion && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      Change any price or quantity, or use ✦ Draft with Claude on a line for a
                      suggested price. Nothing is sent until you click {sendText}.
                    </Text>
                  )}

                  {isSubmitted ? (
                    <div>
                      <BlockStack gap="400">
                        {lines.map((line) => {
                          const suggestion = suggestions[line.id];
                          const showSuggestion = suggestion && !dismissed.has(line.id);
                          return (
                            <BlockStack key={line.id} gap="200">
                              <input type="hidden" name="lineId" value={line.id} />
                              <InlineStack gap="300" align="space-between" blockAlign="end" wrap>
                                <Box minWidth="14rem">
                                  <Text as="p" fontWeight="semibold">
                                    {line.title}
                                  </Text>
                                  {line.sku && (
                                    <Text as="p" tone="subdued" variant="bodySm">
                                      SKU {line.sku}
                                    </Text>
                                  )}
                                </Box>
                                <Box minWidth="7rem">
                                  <TextField
                                    label="Quantity"
                                    type="number"
                                    name={`quantity_${line.id}`}
                                    value={line.quantityInput}
                                    onChange={(v) => setLine(line.id, "quantityInput", v)}
                                    min={1}
                                    autoComplete="off"
                                  />
                                </Box>
                                <Box minWidth="9rem">
                                  <TextField
                                    label="Unit price"
                                    type="number"
                                    name={`price_${line.id}`}
                                    value={line.priceInput}
                                    onChange={(v) => setLine(line.id, "priceInput", v)}
                                    min={0}
                                    step={0.01}
                                    autoComplete="off"
                                  />
                                </Box>
                              </InlineStack>

                              {showAi && access.allowed && (
                                <InlineStack gap="200" blockAlign="center">
                                  <Button
                                    size="slim"
                                    disabled={aiFetcher.state !== "idle"}
                                    onClick={() => aiFetcher.submit({ intent: "ai-suggest", lineId: line.id }, { method: "post" })}
                                  >
                                    {suggestion ? "✦ Refresh Claude draft" : "✦ Draft with Claude"}
                                  </Button>
                                  {generatingLineId === line.id && (
                                    <InlineStack gap="100" blockAlign="center">
                                      <Spinner accessibilityLabel="Getting suggestion" size="small" />
                                      <Text as="span" tone="subdued" variant="bodySm">
                                        Thinking…
                                      </Text>
                                    </InlineStack>
                                  )}
                                </InlineStack>
                              )}

                              {showSuggestion && (
                                <AiSuggestionPanel
                                  suggestion={suggestion}
                                  onAccept={() => setLine(line.id, "priceInput", cleanPrice(suggestion.suggestedPrice))}
                                  onDismiss={() => setDismissed((prev) => new Set(prev).add(line.id))}
                                />
                              )}
                              <Divider />
                            </BlockStack>
                          );
                        })}

                        {customItems.map((c) => (
                          <BlockStack key={`custom-${c.key}`} gap="200">
                            <InlineStack gap="300" align="space-between" blockAlign="end" wrap>
                              <Box minWidth="14rem">
                                <TextField
                                  label="Custom item"
                                  value={c.title}
                                  onChange={(v) => setCustom(c.key, "title", v)}
                                  placeholder="e.g. Setup fee"
                                  autoComplete="off"
                                />
                              </Box>
                              <Box minWidth="7rem">
                                <TextField label="Quantity" type="number" value={c.quantity} onChange={(v) => setCustom(c.key, "quantity", v)} min={1} autoComplete="off" />
                              </Box>
                              <Box minWidth="9rem">
                                <TextField label="Unit price" type="number" value={c.price} onChange={(v) => setCustom(c.key, "price", v)} min={0.01} step={0.01} autoComplete="off" />
                              </Box>
                              <Button
                                variant="plain"
                                tone="critical"
                                accessibilityLabel={`Remove custom item ${c.title || ""}`.trim()}
                                onClick={() => setCustomItems((prev) => prev.filter((x) => x.key !== c.key))}
                              >
                                Remove
                              </Button>
                            </InlineStack>
                            <Divider />
                          </BlockStack>
                        ))}

                        <InlineStack gap="200">
                          <Button
                            onClick={() => setCustomItems((prev) => [...prev, { key: nextKey(), title: "", quantity: "1", price: "" }])}
                            disabled={customItems.length >= 20}
                          >
                            Add custom item
                          </Button>
                          {showAi && access.allowed && (
                            <Button
                              disabled={aiFetcher.state !== "idle"}
                              loading={Boolean(generatingAll)}
                              onClick={() => aiFetcher.submit({ intent: "ai-suggest-all" }, { method: "post" })}
                            >
                              ✦ Draft all lines with Claude
                            </Button>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </div>
                  ) : (
                    <BlockStack gap="300">
                      {lines.map((line) => (
                        <InlineStack key={line.id} align="space-between" wrap>
                          <Box minWidth="14rem">
                            <Text as="p" fontWeight="semibold">
                              {line.title}
                            </Text>
                            {line.sku && (
                              <Text as="p" tone="subdued" variant="bodySm">
                                SKU {line.sku}
                              </Text>
                            )}
                          </Box>
                          <Text as="span" numeric>
                            {line.quantity} × {money(line.price)}
                          </Text>
                        </InlineStack>
                      ))}
                      {stored.customItems.map((c, i) => (
                        <InlineStack key={`custom-${i}`} align="space-between" wrap>
                          <Box minWidth="14rem">
                            <Text as="p" fontWeight="semibold">
                              {c.title}
                            </Text>
                            <Text as="p" tone="subdued" variant="bodySm">
                              Custom item
                            </Text>
                          </Box>
                          <Text as="span" numeric>
                            {c.quantity} × {money(c.price)}
                          </Text>
                        </InlineStack>
                      ))}
                      {countered && (
                        <Text as="p" tone="subdued">
                          You’ve sent this quote. It’s now with the buyer to accept.
                        </Text>
                      )}
                      {quote.buyerMessage && (
                        <Box paddingBlockStart="100">
                          <Text as="p" tone="subdued" variant="bodySm">
                            Message sent to the buyer
                          </Text>
                          <Text as="p">{quote.buyerMessage}</Text>
                        </Box>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              <ShopifyTotals
                quoteId={quote.id}
                ordered={quote.status === "ORDERED"}
                editable={isSubmitted}
                fields={quoteFields}
                editor={
                  isSubmitted ? (
                    <BlockStack gap="300">
                      {discount.open ? (
                        <InlineStack gap="300" blockAlign="end" wrap>
                          <Box minWidth="9rem">
                            <Select
                              label="Discount type"
                              options={[
                                { label: "Percentage", value: "PERCENTAGE" },
                                { label: "Amount", value: "FIXED_AMOUNT" },
                              ]}
                              value={discount.type}
                              onChange={(v) => setDiscount((d) => ({ ...d, type: v as "PERCENTAGE" | "FIXED_AMOUNT" }))}
                            />
                          </Box>
                          <Box minWidth="7rem">
                            <TextField
                              label={discount.type === "PERCENTAGE" ? "Discount (%)" : "Discount amount"}
                              type="number"
                              value={discount.value}
                              onChange={(v) => setDiscount((d) => ({ ...d, value: v }))}
                              min={0.01}
                              step={0.01}
                              autoComplete="off"
                            />
                          </Box>
                          <Box minWidth="12rem">
                            <TextField
                              label="Reason (shown to the buyer)"
                              value={discount.title}
                              onChange={(v) => setDiscount((d) => ({ ...d, title: v }))}
                              placeholder="e.g. Volume discount"
                              autoComplete="off"
                            />
                          </Box>
                          <Button variant="plain" tone="critical" onClick={() => setDiscount({ open: false, type: "PERCENTAGE", value: "", title: "" })}>
                            Remove discount
                          </Button>
                        </InlineStack>
                      ) : null}
                      {shipping.open ? (
                        <InlineStack gap="300" blockAlign="end" wrap>
                          <Box minWidth="12rem">
                            <TextField label="Shipping name" value={shipping.title} onChange={(v) => setShipping((x) => ({ ...x, title: v }))} autoComplete="off" />
                          </Box>
                          <Box minWidth="7rem">
                            <TextField
                              label="Shipping price"
                              type="number"
                              value={shipping.price}
                              onChange={(v) => setShipping((x) => ({ ...x, price: v }))}
                              min={0}
                              step={0.01}
                              helpText="0 for free shipping"
                              autoComplete="off"
                            />
                          </Box>
                          <Button variant="plain" tone="critical" onClick={() => setShipping({ open: false, title: "Shipping", price: "" })}>
                            Remove shipping
                          </Button>
                        </InlineStack>
                      ) : null}
                      <InlineStack gap="200">
                        {!discount.open && <Button onClick={() => setDiscount((d) => ({ ...d, open: true }))}>Add discount</Button>}
                        {!shipping.open && <Button onClick={() => setShipping((x) => ({ ...x, open: true }))}>Add shipping</Button>}
                      </InlineStack>
                    </BlockStack>
                  ) : null
                }
                footer={
                  isSubmitted ? (
                    <BlockStack gap="300">
                      <Divider />
                      <TextField
                        label="Message to buyer"
                        value={buyerMessage}
                        onChange={setBuyerMessage}
                        multiline={3}
                        maxLength={2000}
                        helpText="Sent with the quote. Optional."
                        autoComplete="off"
                      />
                      {sendBlocked && (
                        <Text as="p" tone="critical">
                          {sendBlocked}
                        </Text>
                      )}
                      <InlineStack align="end">
                        <Button
                          variant="primary"
                          onClick={sendQuote}
                          loading={submitting && navigation.formData?.get("intent") === "counter"}
                          disabled={Boolean(replyLock) || Boolean(sendBlocked) || submitting}
                        >
                          {sendText}
                        </Button>
                      </InlineStack>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Shopify recalculates the totals when you send. If it can’t, nothing is sent.
                      </Text>
                    </BlockStack>
                  ) : null
                }
              />

              {canConvert && (
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">Turn this into an order</Text>
                    <Text as="p" tone="subdued" variant="bodyMd">
                      Creates a Shopify draft order at the agreed prices on the buyer’s company location and
                      emails them the invoice. Shopify calculates tax and totals.
                      {quote.status === "COUNTERED" && " Use this once the buyer has agreed to your counter."}
                    </Text>
                    <InlineStack>
                      <Button variant="primary" onClick={() => post("convert")} loading={submitting}>
                        Convert to order
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Timeline</Text>
                  {timeline.length === 0 ? (
                    <Text as="p" tone="subdued">Nothing has happened on this quote yet.</Text>
                  ) : (
                    <BlockStack as="ul" gap="200">
                      {timeline.map((t, i) => (
                        <Box as="li" key={`${t.at}-${i}`}>
                          <InlineStack align="space-between" gap="300" wrap={false}>
                            <Text as="span" tone={t.tone}>{t.text}</Text>
                            <Text as="span" tone="subdued" variant="bodySm">{formatDateTime(t.at)}</Text>
                          </InlineStack>
                        </Box>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* AI-14 add-ons: useful, not the job — one click away. */}
              {showAi && access.allowed && (
                <DisclosureCard
                  title="Suggested add-ons"
                  subtitle="Ask Claude for complementary items from your catalog. You decide what to add."
                >
                  <UpsellBundle quoteId={quote.id} />
                </DisclosureCard>
              )}
            </BlockStack>
          </Layout.Section>

          {/* Aside: who, when, and the documents — the summary a merchant scans. */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Customer</Text>
                  <Text as="p" fontWeight="semibold">{quote.companyName}</Text>
                  <Text as="p" tone="subdued">{quote.buyerEmail}</Text>
                  {quote.poReference && <Text as="p" tone="subdued">PO {quote.poReference}</Text>}
                  {lastEmail && lastEmail.status === "SENT" && (
                    <Text as="p" tone="subdued" variant="bodySm">{`Last email: ${lastEmail.label}, sent ${formatDate(lastEmail.createdAt)}`}</Text>
                  )}
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Details</Text>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Status</Text>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Received</Text>
                    <Text as="span">{formatDate(quote.createdAt)}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Expires</Text>
                    <Text as="span">{formatDate(quote.expiresAt)}</Text>
                  </InlineStack>
                  {orderUrl && (
                    <InlineStack align="space-between">
                      <Text as="span" tone="subdued">Order</Text>
                      <PolarisLink url={orderUrl}>Open in Shopify</PolarisLink>
                    </InlineStack>
                  )}
                  {countered && aiEnabled && hasAnySuggestion && (
                    <Text as="p" tone="subdued" variant="bodySm">
                      Internal note: a Claude draft was used on this quote. Buyers never see this.
                    </Text>
                  )}
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Notes</Text>
                  <TextField
                    label="Internal note"
                    labelHidden
                    value={note}
                    onChange={setNote}
                    multiline={3}
                    maxLength={5000}
                    placeholder="Only your team sees this."
                    autoComplete="off"
                  />
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued" variant="bodySm">
                      {noteFetcher.data && noteFetcher.data.kind === "note"
                        ? noteFetcher.data.ok
                          ? "Saved."
                          : noteFetcher.data.error
                        : "Never shown to the buyer."}
                    </Text>
                    <Button
                      size="slim"
                      onClick={() => noteFetcher.submit({ intent: "note", internalNote: note }, { method: "post" })}
                      loading={noteFetcher.state !== "idle"}
                      disabled={note === (quote.internalNote ?? "") && !noteFetcher.data}
                    >
                      Save note
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
              {quoteOpsEnabled && (
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">Documents</Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      A branded PDF of this quote. Shopify calculates the final tax and total at checkout.
                    </Text>
                    <InlineStack gap="200">
                      <Button url={`/app/quotes/${quote.id}.pdf`} target="_blank">Download PDF</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function AiSuggestionPanel({
  suggestion,
  onAccept,
  onDismiss,
}: {
  // Loader-serialized shape (createdAt is a string over the wire and unused here).
  suggestion: Omit<SuggestionView, "createdAt">;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const marginLabel =
    suggestion.marginPct == null
      ? "Margin: unknown (no cost on file)"
      : `Margin ${Math.round(suggestion.marginPct * 100)}%`;
  return (
    <Box
      background={suggestion.belowFloor ? "bg-surface-critical" : "bg-surface-secondary"}
      borderRadius="200"
      padding="300"
    >
      <BlockStack gap="200">
        <InlineStack gap="200" align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" fontWeight="semibold">
              Claude suggests ${money(suggestion.suggestedPrice)}
            </Text>
            <Badge tone={suggestion.belowFloor ? "critical" : "success"}>{marginLabel}</Badge>
          </InlineStack>
          <Text as="span" tone="subdued" variant="bodySm">
            Floor ${money(suggestion.floorPrice)}
          </Text>
        </InlineStack>

        {suggestion.belowFloor && (
          <Text as="p" tone="critical" variant="bodySm">
            This price is below your floor margin. Review before sending — one-click
            accept is disabled.
          </Text>
        )}

        <Text as="p" variant="bodySm">
          {suggestion.rationale}
        </Text>

        <Box background="bg-surface" borderRadius="100" padding="200">
          <Text as="p" variant="bodySm" tone="subdued">
            Draft message to buyer
          </Text>
          <Text as="p" variant="bodySm">
            {suggestion.draftMessage}
          </Text>
        </Box>

        <InlineStack gap="200">
          <Button size="slim" variant="primary" disabled={suggestion.belowFloor} onClick={onAccept}>
            Use this price
          </Button>
          <Button size="slim" variant="plain" onClick={onDismiss}>
            Dismiss
          </Button>
        </InlineStack>

        {/* Shared trust line — closes every Claude output (guardrail #4). */}
        <InlineStack gap="200" blockAlign="center" wrap>
          <Badge tone="info">✦ Drafted by Claude</Badge>
          <Text as="span" variant="bodySm">
            {DRAFTED_BY_CLAUDE_TRUST}
          </Text>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

/**
 * TC2 — Shopify's subtotal, tax and total for this quote. Fetched after the page
 * renders (so the quote shows at once), from draftOrderCalculate or, once
 * ordered, the stored Shopify snapshot. Never computed in the app.
 */
/** Shopify's draft-order and payment status in plain words (display only). */
function paymentStatus(d: { status: string; invoiceSentAt: string | null; order: { financialStatus: string | null } | null } | null) {
  if (!d) return null;
  if (d.order) {
    const fs = d.order.financialStatus ?? "";
    const label = fs ? fs.charAt(0) + fs.slice(1).toLowerCase().replace(/_/g, " ") : "Order placed";
    const tone: "success" | "attention" | "warning" | undefined = fs === "PAID" ? "success" : fs === "PENDING" || fs === "PARTIALLY_PAID" ? "attention" : fs === "REFUNDED" || fs === "VOIDED" ? "warning" : undefined;
    return { label: `Payment: ${label}`, tone, detail: "Shopify turned the draft into an order. Payment is tracked on the order in Shopify." };
  }
  if (d.status === "INVOICE_SENT") {
    return { label: "Invoice sent", tone: "attention" as const, detail: `Shopify emailed the invoice${d.invoiceSentAt ? ` on ${formatDate(d.invoiceSentAt)}` : ""}. Waiting for the buyer to pay.` };
  }
  return { label: "Invoice not sent", tone: "attention" as const, detail: "Send the invoice and Shopify emails the buyer a link to pay." };
}

function ShopifyTotals({
  quoteId,
  ordered,
  editable,
  fields,
  editor,
  footer,
}: {
  quoteId: string;
  ordered: boolean;
  editable: boolean;
  /** The form's current lines and adjustments, priced by Shopify on Recalculate. */
  fields: () => Array<[string, string]>;
  editor?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const fetcher = useFetcher<typeof totalsLoader>();
  const [previewingEdits, setPreviewingEdits] = useState(false);

  useEffect(() => {
    fetcher.load(`/app/quote-totals/${quoteId}`);
    // Load once per quote; "Recalculate" re-prices the edited values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  const recalculate = () => {
    const qs = new URLSearchParams({ edits: "1" });
    for (const [k, v] of fields()) qs.append(k, v);
    setPreviewingEdits(true);
    fetcher.load(`/app/quote-totals/${quoteId}?${qs.toString()}`);
  };

  const data = fetcher.data ?? null;
  const loading = fetcher.state !== "idle" || !data;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Payment
          </Text>
          {editable && (
            <Button size="slim" onClick={recalculate} loading={fetcher.state !== "idle" && previewingEdits}>
              Recalculate
            </Button>
          )}
        </InlineStack>
        <div aria-live="polite">
          {loading ? (
            <SkeletonBodyText lines={3} />
          ) : !data.ok ? (
            <Banner tone="warning" title="Totals unavailable">
              <p>{data.message}</p>
            </Banner>
          ) : (
            <BlockStack gap="150">
              <InlineStack align="space-between">
                <Text as="span">Subtotal</Text>
                <Text as="span" numeric>{formatMoney(data.totals.subtotal, data.totals.currencyCode)}</Text>
              </InlineStack>
              {data.totals.totalDiscounts && (
                <InlineStack align="space-between">
                  <Text as="span">Discount</Text>
                  <Text as="span" numeric>{`−${formatMoney(data.totals.totalDiscounts, data.totals.currencyCode)}`}</Text>
                </InlineStack>
              )}
              {data.totals.totalShipping && (
                <InlineStack align="space-between">
                  <Text as="span">Shipping</Text>
                  <Text as="span" numeric>{formatMoney(data.totals.totalShipping, data.totals.currencyCode)}</Text>
                </InlineStack>
              )}
              <InlineStack align="space-between">
                <Text as="span">Tax</Text>
                <Text as="span" numeric>{formatMoney(data.totals.totalTax, data.totals.currencyCode)}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="span" fontWeight="semibold">Total</Text>
                <Text as="span" numeric fontWeight="semibold">
                  {formatMoney(data.totals.total, data.totals.currencyCode)} {data.totals.currencyCode}
                </Text>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                {data.source === "snapshot"
                  ? ordered
                    ? "Calculated by Shopify when the order was created."
                    : "Calculated by Shopify when this quote was sent."
                  : previewingEdits
                    ? "Calculated by Shopify for what’s on this page. Not saved until you send."
                    : ordered
                      ? "Calculated by Shopify."
                      : "Calculated by Shopify for this buyer’s company location."}
              </Text>
            </BlockStack>
          )}
        </div>
        {editor}
        {footer}
      </BlockStack>
    </Card>
  );
}
