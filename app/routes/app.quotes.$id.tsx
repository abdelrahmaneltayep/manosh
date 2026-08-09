import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  TextField,
  Button,
  Banner,
  Box,
  Divider,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  counterQuoteForShop,
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
  DRAFTED_BY_CLAUDE_TRUST,
  type ClaudeAccess,
} from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { appendAiEvent } from "../services/claude.server";
import { UpgradeToClaude } from "../components/UpgradeToClaude";
import { convertQuoteToOrder, QuoteConvertError } from "../services/quote-convert.server";
import { DraftOrderError } from "../services/draft-order.server";
import { renderQuotePdf } from "../services/quote-pdf.server";
import { duplicateQuote, QuoteNotFoundForShopError } from "../services/quote-duplicate.server";
import { sendEmail } from "../services/mailer.server";
import { appendEvent } from "../services/events.server";
import { getCatalog } from "../services/catalog.server";
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
import { formatDate } from "../lib/format";

const IS_TEST = process.env.NODE_ENV !== "production";
// Dark-launch flag for Feature 1. AI UI + action are inert unless this is on.
const AI_QUOTE_ENABLED = () => process.env.MANNON_FF_AI_QUOTE === "true";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quote = await getQuoteDetailForShop(session.shop, params.id!);
  if (!quote) {
    throw new Response("Quote not found", { status: 404 });
  }

  const aiEnabled = AI_QUOTE_ENABLED();
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
    suggestions,
    quote: {
      id: quote.id,
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

  // --- F25.1 email the branded quote PDF to the buyer (paid) -----------------
  if (intent === "pdf-email") {
    const status = await requireBilling(billing, { isTest: IS_TEST });
    if (!featureAccess(status, STARTER_PLAN).allowed) {
      return { ok: false as const, kind: "quote" as const, error: "Emailing the quote PDF needs a paid plan.", upgrade: true as const };
    }
    const catalog = await getCatalog(session.shop);
    const currencyCode = catalog[0]?.currencyCode ?? "USD";
    const pdf = await renderQuotePdf(session.shop, quoteId, { currencyCode, plan: status.plan });
    if (!pdf) return { ok: false as const, kind: "quote" as const, error: "Quote not found." };
    await sendEmail({
      to: pdf.buyerEmail,
      subject: "Your quote",
      html: "<p>Your quote is attached as a PDF.</p>",
      text: "Your quote is attached as a PDF.",
      attachments: [{ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }],
    });
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
      await counterQuoteForShop(session.shop, quoteId, parsed.lines);
      return { ok: true as const, kind: "quote" as const, message: "Counter sent to the buyer." };
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

export default function QuoteDetail() {
  const { quote, aiEnabled, access, quoteOpsEnabled, suggestions } = useLoaderData<typeof loader>();
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

  return (
    <Page
      backAction={{ content: "Quotes", url: "/app/quotes" }}
      title={quote.companyName}
      titleMetadata={<Badge tone={badge.tone}>{badge.label}</Badge>}
      subtitle={quote.buyerEmail}
    >
      <TitleBar title="Quote" />
      <BlockStack gap="400">
        {quoteAction && !quoteAction.ok && (
          <Banner tone="critical" title="Couldn’t update this quote">
            <p>{quoteAction.error}</p>
          </Banner>
        )}
        {quoteAction && quoteAction.ok && (
          <Banner tone="success" title={quoteAction.message} />
        )}
        {(aiActionError || aiFetcherError) && (
          <Banner tone="warning" title="Draft with Claude">
            <p>{aiActionError || aiFetcherError}</p>
          </Banner>
        )}

        {/* Starter trial countdown — only while the 7-day Claude trial is running. */}
        {showAi && access.state === "trial" && access.daysLeft != null && (
          <InlineStack gap="200" blockAlign="center">
            <Badge tone="attention">
              {`Claude trial · ${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left`}
            </Badge>
          </InlineStack>
        )}

        {/* First-run tip: only for eligible merchants with no suggestions yet. */}
        {showAi && access.allowed && !hasAnySuggestion && (
          <Banner tone="info" title="Draft a counter-offer with Claude">
            <p>
              Click <b>Draft with Claude</b> on any line to get a suggested price, a
              margin read, and a ready-to-send message. Claude drafts it — you always
              confirm before it’s sent.
            </p>
          </Banner>
        )}

        {/* Locked (Free, or Starter after the trial) — the shared upgrade nudge. */}
        {showAi && !access.allowed && (
          <UpgradeToClaude access={access} upgradeUrl="/app/settings" />
        )}

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="400" wrap>
              <Text as="span" tone="subdued">
                Received {formatDate(quote.createdAt)}
              </Text>
              <Text as="span" tone="subdued">
                Expires {formatDate(quote.expiresAt)}
              </Text>
              {quote.poReference && (
                <Text as="span" tone="subdued">
                  PO {quote.poReference}
                </Text>
              )}
              {quote.draftOrderId && (
                <Text as="span" tone="subdued">
                  Draft order created
                </Text>
              )}
            </InlineStack>

            <Divider />

            {isSubmitted ? (
              <Form method="post">
                <input type="hidden" name="intent" value="counter" />
                <BlockStack gap="400">
                  {lines.map((line) => {
                    const suggestion = suggestions[line.id];
                    const showSuggestion = suggestion && !dismissed.has(line.id);
                    return (
                      <BlockStack key={line.id} gap="200">
                        <input type="hidden" name="lineId" value={line.id} />
                        <InlineStack gap="300" align="space-between" blockAlign="end" wrap>
                          <Box minWidth="16rem">
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
                              prefix="$"
                              autoComplete="off"
                            />
                          </Box>
                        </InlineStack>

                        {/* Draft-with-Claude control (per line) */}
                        {showAi && access.allowed && (
                          <InlineStack gap="200" blockAlign="center">
                            <Button
                              size="slim"
                              disabled={aiFetcher.state !== "idle"}
                              onClick={() =>
                                aiFetcher.submit(
                                  { intent: "ai-suggest", lineId: line.id },
                                  { method: "post" },
                                )
                              }
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
                            onAccept={() =>
                              setLine(line.id, "priceInput", cleanPrice(suggestion.suggestedPrice))
                            }
                            onDismiss={() =>
                              setDismissed((prev) => new Set(prev).add(line.id))
                            }
                          />
                        )}
                        <Divider />
                      </BlockStack>
                    );
                  })}

                  <InlineStack gap="200">
                    <Button variant="primary" submit loading={submitting}>
                      Send counter
                    </Button>
                    {showAi && access.allowed && (
                      <Button
                        disabled={aiFetcher.state !== "idle"}
                        loading={Boolean(generatingAll)}
                        onClick={() =>
                          aiFetcher.submit({ intent: "ai-suggest-all" }, { method: "post" })
                        }
                      >
                        ✦ Draft all lines with Claude
                      </Button>
                    )}
                  </InlineStack>
                </BlockStack>
              </Form>
            ) : (
              <BlockStack gap="300">
                {lines.map((line) => (
                  <InlineStack key={line.id} align="space-between" wrap>
                    <Box minWidth="16rem">
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
                      {line.quantity} × ${money(line.price)}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {countered && (
          <BlockStack gap="150">
            <Text as="p" tone="subdued">
              You’ve countered this quote. It’s now with the buyer to accept.
            </Text>
            {aiEnabled && hasAnySuggestion && (
              <Text as="p" tone="subdued" variant="bodySm">
                Internal note: a Claude draft was used on this quote. Buyers never
                see this.
              </Text>
            )}
          </BlockStack>
        )}

        {quoteOpsEnabled && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Documents</Text>
              <Text as="p" tone="subdued" variant="bodyMd">A branded PDF of this quote (line items, totals, validity). Taxes and the final total are calculated by Shopify at checkout.</Text>
              <InlineStack gap="200">
                <Button url={`/app/quotes/${quote.id}.pdf`} target="_blank" variant="secondary">Download PDF</Button>
                <Form method="post">
                  <input type="hidden" name="intent" value="pdf-email" />
                  <Button submit loading={submitting}>Email PDF to buyer</Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="duplicate" />
                  <Button submit loading={submitting}>Create a similar quote</Button>
                </Form>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {quoteOpsEnabled && (quote.status === "ACCEPTED" || quote.status === "COUNTERED") && !quote.draftOrderId && !quote.convertedOrderId && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Turn this into an order</Text>
              <Text as="p" tone="subdued" variant="bodyMd">
                Creates a native draft order at the agreed prices on the buyer’s company location and emails them the invoice.
                Shopify calculates tax and totals — we never re-price from the catalog.
                {quote.status === "COUNTERED" && " Use this once the buyer has agreed to your counter."}
              </Text>
              <Form method="post">
                <input type="hidden" name="intent" value="convert" />
                <Button submit variant="primary" loading={submitting}>Convert to order &amp; send invoice</Button>
              </Form>
            </BlockStack>
          </Card>
        )}

        {(quote.draftOrderId || quote.convertedOrderId) && (
          <Banner tone="success" title="Order created">
            The draft order is in Shopify (Orders → Drafts) with the invoice sent. Totals are Shopify’s.
          </Banner>
        )}

        {!isTerminal && (
          <Form method="post">
            <input type="hidden" name="intent" value="decline" />
            <Button submit tone="critical" variant="plain" loading={submitting}>
              Decline quote
            </Button>
          </Form>
        )}
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
