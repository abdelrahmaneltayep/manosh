import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
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
  Divider,
  ButtonGroup,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { requireBilling } from "../services/billing.server";
import { featureAccess, GROWTH_PLAN } from "../lib/billing";
import { appendEvent } from "../services/events.server";
import { getAnalytics } from "../services/quote-analytics.server";
import { MIN_QUOTES_FOR_ANALYTICS } from "../lib/analytics-quotes";
import { claudeAccess, CLAUDE_UNAVAILABLE_COPY, CLAUDE_UPGRADE_COPY, CLAUDE_TRIAL_ENDED_COPY, type ClaudeAccess } from "../config/plans";
import { requireClaudeAccess } from "../services/claude-access.server";
import { draftWinRateInsight } from "../services/insights-ai.server";
import { DraftedByClaude } from "../components/DraftedByClaude";

const IS_TEST = process.env.NODE_ENV !== "production";
const ENABLED = () => process.env.MANNON_FF_QUOTE_ANALYTICS === "true";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });
  const status = await requireBilling(billing, { isTest: IS_TEST });
  const isGrowth = featureAccess(status, GROWTH_PLAN).allowed;
  const range = Number(new URL(request.url).searchParams.get("range")) === 90 ? 90 : 30;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: true, legacyPlan: true, claudeTrialStartedAt: true, claudeEnabled: true },
  });
  const access = claudeAccess(shop ?? { plan: "FREE" }, new Date());

  if (!isGrowth) {
    return { locked: true as const, range, analytics: null, minQuotes: MIN_QUOTES_FOR_ANALYTICS, access };
  }

  const analytics = await getAnalytics(session.shop, range);
  if (shop && analytics && analytics.count >= MIN_QUOTES_FOR_ANALYTICS) {
    await appendEvent({ shopId: shop.id, type: "ANALYTICS_VIEWED", entityType: "Shop", entityId: shop.id, payload: { range } });
  }
  return { locked: false as const, range, analytics, minQuotes: MIN_QUOTES_FOR_ANALYTICS, access };
};

type InsightResult =
  | { ok: true; insight: string; suggestedAction: string }
  | { ok: false; error: string; upgrade?: boolean };

// AI-12 win-rate insight — Claude reads the numbers and drafts a plain-language
// takeaway + one action. Dual-mode: advisory text only, nothing is changed.
export const action = async ({ request }: ActionFunctionArgs): Promise<InsightResult> => {
  const { session } = await authenticate.admin(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  const { access } = await requireClaudeAccess(session.shop, { startTrialOnUse: true });
  if (!access.allowed) {
    return {
      ok: false,
      upgrade: true,
      error: access.reason === "trial-ended" ? CLAUDE_TRIAL_ENDED_COPY : CLAUDE_UPGRADE_COPY,
    };
  }
  const form = await request.formData();
  const range = Number(form.get("range")) === 90 ? 90 : 30;
  try {
    const drafted = await draftWinRateInsight(session.shop, range);
    if (!drafted) return { ok: false, error: "Not enough quote data yet for a read." };
    return { ok: true, insight: drafted.insight, suggestedAction: drafted.suggestedAction };
  } catch {
    return { ok: false, error: CLAUDE_UNAVAILABLE_COPY };
  }
};

function money(currency: string, n: number): string {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
function hrs(n: number | null): string {
  if (n == null) return "—";
  if (n < 48) return `${Math.round(n)}h`;
  return `${(n / 24).toFixed(1)}d`;
}

function Sparkline({ points, tone = "#4F46E5" }: { points: number[]; tone?: string }) {
  const w = 120;
  const h = 34;
  if (points.length < 2) return <svg width={w} height={h} aria-hidden="true" />;
  const max = Math.max(1, ...points);
  const step = w / (points.length - 1);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - (v / max) * (h - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ label, value, spark, tone }: { label: string; value: string; spark: number[]; tone?: string }) {
  return (
    <Box background="bg-surface" borderWidth="025" borderColor="border" borderRadius="300" padding="400">
      <BlockStack gap="150">
        <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
        <Text as="p" variant="heading2xl">{value}</Text>
        <Sparkline points={spark} tone={tone} />
      </BlockStack>
    </Box>
  );
}

function WinRateInsight({ range, access }: { range: number; access: Pick<ClaudeAccess, "allowed"> }) {
  const fetcher = useFetcher<typeof action>();
  if (!access.allowed) return null;
  const busy = fetcher.state !== "idle";
  const d = fetcher.data;
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap gap="200">
          <Text as="h3" variant="headingSm">What changed, and what to do</Text>
          <fetcher.Form method="post">
            <input type="hidden" name="range" value={range} />
            <Button submit size="slim" disabled={busy} loading={busy}>
              ✦ Explain with Claude
            </Button>
          </fetcher.Form>
        </InlineStack>
        {d && !d.ok && <Banner tone="warning">{d.error}</Banner>}
        {d && d.ok && (
          <DraftedByClaude>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">{d.insight}</Text>
              {d.suggestedAction && (
                <Text as="p" variant="bodyMd" fontWeight="semibold">Suggested next step: {d.suggestedAction}</Text>
              )}
            </BlockStack>
          </DraftedByClaude>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Analytics() {
  const data = useLoaderData<typeof loader>();

  if (data.locked) {
    return (
      <Page>
        <TitleBar title="Quote analytics" />
        <BlockStack gap="400">
          <Banner tone="warning" title="Quote analytics is a Growth feature">
            <p>See win rate, average discount, time-to-close, and your open pipeline. Upgrade to Growth to unlock it.</p>
            <Box paddingBlockStart="200"><Button url="/app/settings" variant="primary">Upgrade to Growth</Button></Box>
          </Banner>
          <Box>
            <div style={{ filter: "blur(5px)", opacity: 0.6, pointerEvents: "none", userSelect: "none" }}>
              <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
                <Kpi label="Win rate" value="62%" spark={[3, 5, 4, 6, 7, 6, 8]} />
                <Kpi label="Avg discount" value="11%" spark={[6, 6, 5, 7, 6, 6, 5]} tone="#A8D423" />
                <Kpi label="Avg time to close" value="1.8d" spark={[5, 4, 4, 3, 4, 3, 3]} />
                <Kpi label="Open pipeline" value="SAR 84,200" spark={[2, 4, 5, 6, 7, 9, 11]} tone="#A8D423" />
              </InlineGrid>
            </div>
          </Box>
        </BlockStack>
      </Page>
    );
  }

  const a = data.analytics;
  const rangeSwitch = (
    <ButtonGroup variant="segmented">
      <Button url="?range=30" pressed={data.range === 30}>30 days</Button>
      <Button url="?range=90" pressed={data.range === 90}>90 days</Button>
    </ButtonGroup>
  );

  if (!a || a.count < data.minQuotes) {
    return (
      <Page>
        <TitleBar title="Quote analytics" />
        <Card>
          <EmptyState heading="Come back after a few quotes" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
            <p>
              Once you’ve sent at least {data.minQuotes} quotes, this dashboard shows
              your win rate, average discount, time-to-close, and pipeline.
            </p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const created = a.series.map((p) => p.created);
  const won = a.series.map((p) => p.won);
  const value = a.series.map((p) => p.value);

  return (
    <Page>
      <TitleBar title="Quote analytics" />
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Last {data.range} days</Text>
          <InlineStack gap="200">
            {rangeSwitch}
            <Button url={`/app/analytics/export?range=${data.range}`} download>Export CSV</Button>
          </InlineStack>
        </InlineStack>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          <Kpi label="Win rate" value={pct(a.kpis.winRate)} spark={won} />
          <Kpi label="Avg discount" value={pct(a.kpis.avgDiscountPct)} spark={value} tone="#A8D423" />
          <Kpi label="Avg time to close" value={hrs(a.kpis.avgTimeToCloseHrs)} spark={created} />
          <Kpi label="Open pipeline" value={money(a.currency, a.kpis.openPipeline)} spark={value} tone="#A8D423" />
        </InlineGrid>

        <WinRateInsight range={data.range} access={data.access} />

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          {/* Top accounts */}
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Top accounts by quote value</Text>
              {a.topAccounts.length === 0 ? (
                <Text as="p" tone="subdued">No accounts yet.</Text>
              ) : (
                <BlockStack gap="0">
                  {a.topAccounts.map((t, i) => (
                    <div key={t.companyId}>
                      {i > 0 && <Divider />}
                      <Box paddingBlock="200">
                        <InlineStack align="space-between">
                          <Text as="span">{t.companyName} <Text as="span" tone="subdued" variant="bodySm">· {t.count} quotes</Text></Text>
                          <Text as="span" numeric>{money(a.currency, t.value)}</Text>
                        </InlineStack>
                      </Box>
                    </div>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>

          {/* Discount leaderboard */}
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Most-discounted SKUs</Text>
              {a.discountLeaders.length === 0 ? (
                <Text as="p" tone="subdued">No price-list discounts to show yet.</Text>
              ) : (
                <BlockStack gap="0">
                  {a.discountLeaders.map((d, i) => (
                    <div key={d.variantId}>
                      {i > 0 && <Divider />}
                      <Box paddingBlock="200">
                        <InlineStack align="space-between">
                          <Text as="span">{d.title}</Text>
                          <Badge tone="attention">{pct(d.avgDiscountPct)}</Badge>
                        </InlineStack>
                      </Box>
                    </div>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Stale quotes */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Stale quotes needing action</Text>
            {a.stale.length === 0 ? (
              <Text as="p" tone="subdued">Nothing stale — your pipeline is fresh.</Text>
            ) : (
              <BlockStack gap="0">
                {a.stale.map((s, i) => (
                  <div key={s.id}>
                    {i > 0 && <Divider />}
                    <Box paddingBlock="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <Link to={`/app/quotes/${s.id}`}>{s.companyName}</Link>
                          <Badge tone="warning">{`${s.ageDays}d old`}</Badge>
                        </InlineStack>
                        <Text as="span" numeric>{money(a.currency, s.value)}</Text>
                      </InlineStack>
                    </Box>
                  </div>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
