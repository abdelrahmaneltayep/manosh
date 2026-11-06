import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, SerializeFrom } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Badge,
  Banner,
  BlockStack,
  InlineGrid,
  InlineStack,
  Box,
  Button,
  Divider,
  ProgressBar,
  Collapsible,
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getDashboardMetrics } from "../services/dashboard.server";
import { shouldPromptReview, markReviewPromptShown } from "../services/review-prompt.server";
import { getAttentionCounts, getSetupProgress, dismissSetupGuide } from "../services/home.server";
import { attentionItems, setupSteps, setupProgress, type AttentionItem, type SetupStep } from "../lib/home";
import { navFlags } from "../lib/nav";
import { EXPIRING_SOON_DAYS } from "../lib/dashboard";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate, formatDuration, formatMoney } from "../lib/format";

// Metrics as they arrive on the client (Dates serialized to strings by Remix).
type Metrics = NonNullable<SerializeFrom<typeof loader>["metrics"]>;

/**
 * Home — the App Home "homepage" pattern, ordered by the merchant's jobs
 * (docs/ux-audit.md):
 *   1. Needs your attention — every inbox with work waiting, one click away.
 *   2. Setup guide — progress, collapsible, dismissible (replaces the 12
 *      onboarding banners that used to stack on Settings).
 *   3. Performance — revenue Mannon made + the four headline metrics (F5,
 *      built from the append-only Event stream; read-only, never computes money).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: true },
  });
  const flags = navFlags(process.env);
  if (!shop) {
    return { metrics: null, promptReview: false, attention: [], steps: [] as SetupStep[], setupDismissed: false, analyticsOn: flags.analytics };
  }
  const [metrics, promptReview, counts, progress] = await Promise.all([
    getDashboardMetrics(shop.id),
    shouldPromptReview(shop.id),
    getAttentionCounts(shop.id),
    getSetupProgress(shop.id),
  ]);
  const growthTier = shop.plan === "GROWTH" || shop.plan === "SCALE";
  const steps = setupSteps({
    quoteWidget: flags.quoteRequests,
    catalogs: flags.catalogs,
    credit: flags.credit,
    tax: flags.tax,
    i18n: flags.i18n,
    payments: flags.payments,
    erp: flags.erp,
    accounting: flags.accounting,
    reps: flags.reps,
    catalogSharing: flags.catalogSharing,
    growthTier,
    onPaidPlan: growthTier || shop.plan === "STARTER",
    ...progress,
  });
  const attention = attentionItems(counts, {
    quoteRequests: flags.quoteRequests,
    offers: flags.offers,
    wholesale: flags.wholesale,
    catalogSharing: flags.catalogSharing,
    credit: flags.credit,
    tax: flags.tax,
  });
  return { metrics, promptReview, attention, steps, setupDismissed: progress.dismissed, analyticsOn: flags.analytics };
};

// Two acknowledgements, both append-only Events so they survive reloads:
// hiding the setup guide, and the review banner (REVIEW_PROMPT_SHOWN, at most once).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop }, select: { id: true } });
  if (!shop) return { ok: true };
  const intent = String((await request.formData()).get("intent") ?? "review");
  if (intent === "dismiss-setup") await dismissSetupGuide(shop.id);
  else await markReviewPromptShown(shop.id);
  return { ok: true };
};

function AttentionCard({ items }: { items: AttentionItem[] }) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Needs your attention
        </Text>
        {items.length === 0 ? (
          <Text as="p" tone="subdued">
            You&rsquo;re all caught up. New quotes, requests and offers show up here as they arrive.
          </Text>
        ) : (
          <BlockStack gap="0">
            {items.map((item, i) => (
              <Box key={item.id}>
                {i > 0 && <Divider />}
                <Box paddingBlock="300">
                  <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Badge tone="attention">{String(item.count)}</Badge>
                      <Text as="span" variant="bodyMd">
                        {item.label.replace(/^\d+\s/, "")}
                      </Text>
                    </InlineStack>
                    <Button url={item.url} accessibilityLabel={`${item.action}: ${item.label}`}>
                      {item.action}
                    </Button>
                  </InlineStack>
                </Box>
              </Box>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function StepMarker({ done }: { done: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 20,
        height: 20,
        flex: "0 0 20px",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        lineHeight: 1,
        color: "var(--p-color-text-inverse)",
        background: done ? "var(--p-color-bg-fill-success)" : "transparent",
        border: done ? "none" : "1.5px dashed var(--p-color-border-secondary)",
      }}
    >
      {done ? "✓" : ""}
    </div>
  );
}

/**
 * App Home setup-guide composition: progress as text + bar, the whole guide
 * collapses, each step collapses with only the first unfinished one open, and
 * the guide can be dismissed for good.
 */
function SetupGuide({ steps }: { steps: SetupStep[] }) {
  const fetcher = useFetcher();
  const { done, total } = setupProgress(steps);
  const firstOpen = steps.find((s) => !s.done)?.id ?? null;
  const [guideOpen, setGuideOpen] = useState(true);
  const [openStep, setOpenStep] = useState<string | null>(firstOpen);
  if (fetcher.state !== "idle" || fetcher.data) return null; // hidden at once on dismiss

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" wrap={false} gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Setup guide
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {`${done} of ${total} tasks completed`}
            </Text>
          </BlockStack>
          <InlineStack gap="200" wrap={false}>
            <Button
              variant="tertiary"
              onClick={() => fetcher.submit({ intent: "dismiss-setup" }, { method: "post" })}
              accessibilityLabel="Dismiss the setup guide"
            >
              Dismiss
            </Button>
            <Button
              variant="tertiary"
              onClick={() => setGuideOpen((v) => !v)}
              ariaExpanded={guideOpen}
              ariaControls="setup-guide-steps"
            >
              {guideOpen ? "Hide steps" : "Show steps"}
            </Button>
          </InlineStack>
        </InlineStack>
        <ProgressBar progress={total ? Math.round((done / total) * 100) : 0} size="small" tone="success" />
        <Collapsible id="setup-guide-steps" open={guideOpen}>
          <BlockStack gap="100">
            {steps.map((step) => {
              const open = openStep === step.id;
              return (
                <Box key={step.id} padding="200" borderRadius="200" background={open ? "bg-surface-secondary" : undefined}>
                  <BlockStack gap="200">
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <StepMarker done={step.done} />
                      <Button
                        variant="plain"
                        textAlign="start"
                        onClick={() => setOpenStep(open ? null : step.id)}
                        ariaExpanded={open}
                        ariaControls={`setup-step-${step.id}`}
                      >
                        {step.title}
                      </Button>
                      <Text as="span" visuallyHidden>
                        {step.done ? "Completed" : "Not completed"}
                      </Text>
                      {step.optional && <Badge>Optional</Badge>}
                    </InlineStack>
                    <Collapsible id={`setup-step-${step.id}`} open={open}>
                      <Box paddingInlineStart="800">
                        <BlockStack gap="200">
                          <Text as="p" tone="subdued">
                            {step.description}
                          </Text>
                          <InlineStack>
                            <Button url={step.action.url} variant={step.done ? "secondary" : "primary"}>
                              {step.action.content}
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Box>
                    </Collapsible>
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}

function MetricTile({ label, value, url }: { label: string; value: string; url?: string }) {
  return (
    <Box background="bg-surface-secondary" borderRadius="200" padding="300">
      <BlockStack gap="100">
        <Text as="span" variant="bodySm" tone="subdued">
          {url ? (
            <PolarisLink url={url} monochrome removeUnderline>
              {label}
            </PolarisLink>
          ) : (
            label
          )}
        </Text>
        <Text as="p" variant="headingXl">
          {value}
        </Text>
      </BlockStack>
    </Box>
  );
}

function PerformanceCard({ metrics, analyticsOn }: { metrics: Metrics | null; analyticsOn: boolean }) {
  const primary = metrics?.revenue[0] ?? null;
  const others = metrics?.revenue.slice(1) ?? [];
  const tileUrl = analyticsOn ? "/app/analytics" : undefined;
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Performance
          </Text>
          {analyticsOn && (
            <Button variant="plain" url="/app/analytics">
              View analytics
            </Button>
          )}
        </InlineStack>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="subdued">
            Revenue Mannon made for you
          </Text>
          <Text as="p" variant="heading2xl">
            {primary ? formatMoney(primary.amount, primary.currencyCode) : "—"}
          </Text>
          {others.length > 0 && (
            <Text as="p" variant="bodySm" tone="subdued">
              plus {others.map((r) => formatMoney(r.amount, r.currencyCode)).join(", ")}
            </Text>
          )}
          <Text as="p" variant="bodySm" tone="subdued">
            {metrics && metrics.ordersCount > 0
              ? `Across ${metrics.ordersCount} order${metrics.ordersCount === 1 ? "" : "s"} sent to Shopify from accepted quotes.`
              : "Your first accepted quote becomes an order here. Shopify calculates every total."}
          </Text>
        </BlockStack>
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
          <MetricTile label="Quotes sent" value={String(metrics?.quotesSent ?? 0)} url={tileUrl} />
          <MetricTile label="Quotes accepted" value={String(metrics?.quotesAccepted ?? 0)} url={tileUrl} />
          <MetricTile label="Reorders" value={String(metrics?.reorders ?? 0)} url={tileUrl} />
          <MetricTile
            label="Median time to quote"
            value={metrics?.medianTimeToQuoteMs == null ? "—" : formatDuration(metrics.medianTimeToQuoteMs)}
            url={tileUrl}
          />
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}

function ExpiringSoonCard({ metrics }: { metrics: Metrics }) {
  if (metrics.expiringSoon.length === 0) return null;
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Expiring in the next {EXPIRING_SOON_DAYS} days
        </Text>
        <BlockStack gap="0">
          {metrics.expiringSoon.map((quote, index) => {
            const badge = quoteStatusBadge(quote.status);
            return (
              <Box key={quote.id}>
                {index > 0 && <Divider />}
                <Box paddingBlock="300">
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <PolarisLink url={`/app/quotes/${quote.id}`} removeUnderline>
                      <Text as="span" fontWeight="semibold">
                        {quote.companyName}
                      </Text>
                    </PolarisLink>
                    <InlineStack gap="300" blockAlign="center">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Expires {formatDate(quote.expiresAt)}
                      </Text>
                    </InlineStack>
                  </InlineStack>
                </Box>
              </Box>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

export default function Index() {
  const { metrics, promptReview, attention, steps, setupDismissed, analyticsOn } = useLoaderData<typeof loader>();
  const reviewFetcher = useFetcher();
  // Hide immediately on click; the action records REVIEW_PROMPT_SHOWN so it
  // won't return on the next load either.
  const showReview = promptReview && reviewFetcher.state === "idle" && !reviewFetcher.data;
  const acknowledgeReview = () => reviewFetcher.submit({ intent: "review" }, { method: "post" });
  const showGuide = !setupDismissed && steps.length > 0 && !setupProgress(steps).complete;

  return (
    <Page>
      <TitleBar title="Mannon" />
      <BlockStack gap="400">
        {showReview && (
          <Banner
            tone="info"
            title="Enjoying Mannon?"
            onDismiss={acknowledgeReview}
            action={{
              content: "Leave a review",
              url: "https://apps.shopify.com/mannon#modal-show=WriteReview",
              external: true,
              onAction: acknowledgeReview,
            }}
          >
            <p>
              You&rsquo;ve turned a quote into a real order. A quick review helps other B2B
              merchants find Mannon.
            </p>
          </Banner>
        )}
        <AttentionCard items={attention as AttentionItem[]} />
        {showGuide && <SetupGuide steps={steps} />}
        <PerformanceCard metrics={metrics} analyticsOn={analyticsOn} />
        {metrics && <ExpiringSoonCard metrics={metrics} />}
      </BlockStack>
    </Page>
  );
}

// Merchant-facing errors stay a friendly page, never a raw stack trace.
export function ErrorBoundary() {
  return (
    <Page>
      <TitleBar title="Mannon" />
      <Banner tone="critical" title="We couldn’t load your home page" action={{ content: "Try again", url: "/app" }}>
        <p>Your data is safe. Reload the page, and if this keeps happening contact Mannon support.</p>
      </Banner>
    </Page>
  );
}
