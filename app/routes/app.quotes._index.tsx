import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useEffect, useState } from "react";
import { useActionData, useLoaderData, useNavigate, useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Badge,
  Banner,
  BlockStack,
  Box,
  Tabs,
  Text,
  TextField,
  EmptyState,
  Pagination,
  Button,
  Link as PolarisLink,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { SectionTabs } from "../components/SectionTabs";
import { listQuotesForShop } from "../services/quote-inbox.server";
import { canCreateQuote } from "../services/plan-limits.server";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate } from "../lib/format";
import { QUOTE_OPS_ENABLED } from "../lib/quote-ops";
import { upgradeUrl } from "../lib/upgrade";
import { isGrowthTier } from "../lib/billing";
import { availableViews, filterQuotes, paginate, sectionTabFor, viewById, viewCounts } from "../lib/quote-views";
import { formatMoney } from "../lib/format";
import { navFlags } from "../lib/nav";
import { featureAvailable, shopPlanHandle } from "../lib/plan-features";
import { listOffers } from "../services/offers.server";
import { emailDeliveryEnabled } from "../services/mailer.server";
import { sendNow } from "../services/followups.server";
import type { OfferStatus } from "@prisma/client";

/** At most this many reminders per bulk send (one click, one request). */
const BULK_REMINDER_MAX = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quotes = await listQuotesForShop(session.shop);

  // Quote-volume usage, for the soft near-cap banner (display only).
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, plan: true, legacyPlan: true },
  });
  const flags = navFlags(process.env);
  // Offers: a view of this table where Make an Offer is on; the plan decides
  // whether it lists offers or explains which plan includes them.
  const offersUnlocked = flags.offers && shop != null && featureAvailable("makeAnOffer", shopPlanHandle(shop));
  const offers = offersUnlocked ? await listOffers(session.shop) : [];
  const allowance = shop ? await canCreateQuote(shop.id) : null;
  const usage =
    allowance && Number.isFinite(allowance.cap)
      ? { used: allowance.used, cap: allowance.cap }
      : null;

  // Bulk import is Growth+; only offer it where it works (no paywall from a header action).
  return {
    quotes,
    usage,
    quoteOpsEnabled: QUOTE_OPS_ENABLED() && isGrowthTier(shop?.plan),
    views: { offers: flags.offers, followups: flags.followups },
    offersUnlocked,
    offers,
    // Bulk reminders need follow-ups on and an email sender connected.
    bulkRemind: flags.followups && emailDeliveryEnabled(),
  };
};

// Bulk "Send reminder" from the Waiting on buyer view. Each reminder goes
// through the follow-up sender, which only sends for an open quote of this
// shop and records the reminder only when it was delivered.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "remind") return { ok: false as const, error: "Unknown action." };
  if (process.env.MANNON_FF_FOLLOWUPS !== "true" || !emailDeliveryEnabled()) {
    return { ok: false as const, error: "Reminders can’t be emailed yet: no email sender is connected. Open Follow-ups to copy each reminder." };
  }
  const ids = [...new Set(form.getAll("quoteId").map(String))].slice(0, BULK_REMINDER_MAX);
  if (ids.length === 0) return { ok: false as const, error: "Select at least one quote." };
  const baseUrl = (process.env.SHOPIFY_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  let sent = 0;
  for (const id of ids) {
    if (await sendNow(session.shop, id, baseUrl).catch(() => false)) sent++;
  }
  const failed = ids.length - sent;
  const people = (n: number) => `${n} buyer${n === 1 ? "" : "s"}`;
  return failed === 0
    ? { ok: true as const, message: `Reminder sent to ${people(sent)}.` }
    : {
        ok: sent > 0,
        message: `Reminder sent to ${people(sent)}. ${failed} couldn’t be sent (the quote is no longer open, or the email wasn’t delivered). Open a quote to copy its link.`,
      };
};

const OFFER_TONE: Record<OfferStatus, "success" | "attention" | "info" | undefined> = {
  PENDING: "attention", COUNTERED: "info", ACCEPTED: "success", DECLINED: undefined, EXPIRED: undefined, CONVERTED: "success",
};
const titleCase = (x: string) => x.charAt(0) + x.slice(1).toLowerCase();

export default function QuotesInbox() {
  const { quotes, usage, quoteOpsEnabled, views, offersUnlocked, offers, bulkRemind } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const available = availableViews(views);
  const atCap = usage && usage.used >= usage.cap;
  const nearCap = usage && usage.used >= usage.cap * 0.8;

  // View, search and page live in the URL so Back, deep links from Home and
  // bookmarks restore exactly what the merchant was looking at.
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const view = viewById(params.get("view"), available);
  const query = params.get("q") ?? "";
  const [search, setSearch] = useState(query);
  useEffect(() => setSearch(query), [query]);
  const go = (next: { view?: string; q?: string; page?: number }) => {
    const p = new URLSearchParams(params);
    const v = next.view ?? view.id;
    if (v === "all") p.delete("view");
    else p.set("view", v);
    const qq = next.q ?? query;
    if (qq) p.set("q", qq);
    else p.delete("q");
    if (next.page && next.page > 1) p.set("page", String(next.page));
    else p.delete("page");
    const qs = p.toString();
    navigate(qs ? `?${qs}` : ".", { replace: next.q !== undefined && next.view === undefined });
  };
  // Debounced search → URL (replace, so typing doesn't flood history).
  useEffect(() => {
    if (search === query) return;
    const t = setTimeout(() => go({ q: search }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const counts: Record<string, number> = { ...viewCounts(quotes), offers: offers.filter((o) => o.status === "PENDING").length };
  const isOffers = view.kind === "offers";
  const filtered = filterQuotes(quotes, view.id, query);
  const pageInfo = paginate(filtered, Number(params.get("page") ?? 1));
  const q = query.trim().toLowerCase();
  const offerRows = offers.filter((o) => !q || o.buyerEmail.toLowerCase().includes(q));
  const tabs = available.map((v) => ({
    id: `view-${v.id}`,
    content: v.label,
    badge: v.id === "all" ? undefined : String(counts[v.id] ?? 0),
    accessibilityLabel: v.kind === "offers" ? `${v.label}, ${counts.offers} waiting` : `${v.label}, ${counts[v.id] ?? 0} quotes`,
    panelID: "quotes-panel",
  }));

  // Bulk reminders: only in Waiting on buyer, only when emails can be sent.
  const selectable = view.id === "waiting" && bulkRemind;
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } = useIndexResourceState(
    pageInfo.rows as unknown as { [key: string]: unknown }[],
  );
  useEffect(() => clearSelection(), [view.id, pageInfo.page, clearSelection]);
  useEffect(() => {
    if (actionData && "message" in actionData) clearSelection();
  }, [actionData, clearSelection]);
  const reminding = navigation.state === "submitting" && navigation.formData?.get("intent") === "remind";
  const remind = () => {
    const fd = new FormData();
    fd.set("intent", "remind");
    for (const id of selectedResources) fd.append("quoteId", id);
    submit(fd, { method: "post" });
  };

  const rows = pageInfo.rows.map((quote, index) => {
    const badge = quoteStatusBadge(quote.displayStatus);
    return (
      <IndexTable.Row id={quote.id} key={quote.id} position={index} selected={selectable && selectedResources.includes(quote.id)}>
        <IndexTable.Cell>
          <PolarisLink url={`/app/quotes/${quote.id}`} removeUnderline>
            <Text as="span" fontWeight="semibold">
              {quote.companyName}
            </Text>
          </PolarisLink>
        </IndexTable.Cell>
        <IndexTable.Cell>{quote.buyerEmail}</IndexTable.Cell>
        <IndexTable.Cell>
          {quote.total ? (
            <Text as="span" alignment="end" numeric>
              {formatMoney(quote.total.amount, quote.total.currencyCode)}
            </Text>
          ) : (
            <Text as="span" alignment="end" tone="subdued">
              Not priced yet
            </Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>{formatDate(quote.createdAt)}</IndexTable.Cell>
        <IndexTable.Cell>{formatDate(quote.expiresAt)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      fullWidth={false}
      primaryAction={quoteOpsEnabled ? { content: "Import quotes", url: "/app/quotes/import" } : undefined}
    >
      <TitleBar title="Quotes" />
      <SectionTabs active={sectionTabFor(view.id)} />
      <BlockStack gap="400">
        {actionData && "message" in actionData && actionData.message && (
          <Banner tone={actionData.ok ? "success" : "warning"}>
            <p>{actionData.message}</p>
          </Banner>
        )}
        {actionData && "error" in actionData && (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {view.id === "waiting" && views.followups && (
          <Banner tone="info">
            <p>
              {bulkRemind
                ? "Select quotes to send each buyer a reminder now. Automatic reminders follow your follow-up settings."
                : "Reminders can be emailed in bulk once an email sender is connected. Until then, Follow-up settings lets you copy each reminder."}{" "}
              <PolarisLink url="/app/followups">Follow-up settings</PolarisLink>
            </p>
          </Banner>
        )}
        {isOffers && offersUnlocked && (
          <InlineStackLinks />
        )}
        {usage && nearCap && (
          <Banner
            tone={atCap ? "critical" : "warning"}
            title={`${usage.used} / ${usage.cap} active quotes this month`}
            action={{ content: "See plans", url: upgradeUrl("starter") }}
          >
            <p>
              {atCap
                ? "You’ve reached the Free plan limit. New requests still arrive, but you can reply to them only after you upgrade or older quotes expire or are ordered. Starter and above have unlimited quotes."
                : "You’re close to the Free plan limit of active quotes. Starter and above have unlimited quotes."}
            </p>
          </Banner>
        )}
        <Card padding="0">
          {quotes.length === 0 && offers.length === 0 && !isOffers ? (
            <EmptyState
              heading="No quotes yet"
              action={{ content: "Invite buyers", url: "/app/buyers" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                When a buyer asks for a quote it lands here. Send your buyers a secure sign-in
                link to get started.
              </p>
            </EmptyState>
          ) : (
            <>
              <Tabs tabs={tabs} selected={available.findIndex((v) => v.id === view.id)} onSelect={(i) => go({ view: available[i].id, page: 1 })} />
              <Box padding="300">
                <TextField
                  label="Search quotes"
                  labelHidden
                  placeholder={isOffers ? "Search by buyer email" : "Search by company or buyer email"}
                  value={search}
                  onChange={setSearch}
                  clearButton
                  onClearButtonClick={() => setSearch("")}
                  autoComplete="off"
                />
              </Box>
              <div id="quotes-panel" role="tabpanel" aria-label={`${view.label} quotes`}>
                {isOffers ? (
                  <OffersPanel unlocked={offersUnlocked} offers={offerRows} searching={Boolean(q)} />
                ) : filtered.length === 0 ? (
                  <Box padding="600">
                    <BlockStack gap="200" inlineAlign="center">
                      <Text as="p" fontWeight="semibold">
                        {query ? "No quotes match your search" : `No ${view.label.toLowerCase()} quotes`}
                      </Text>
                      <Text as="p" tone="subdued">
                        {query ? "Try a different company name or email." : "Quotes show up here when they reach this status."}
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <IndexTable
                    resourceName={{ singular: "quote", plural: "quotes" }}
                    itemCount={pageInfo.rows.length}
                    selectable={selectable}
                    selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                    onSelectionChange={handleSelectionChange}
                    promotedBulkActions={
                      selectable
                        ? [{ content: reminding ? "Sending…" : "Send reminder", onAction: remind, disabled: reminding || selectedResources.length > BULK_REMINDER_MAX }]
                        : undefined
                    }
                    headings={[
                      { title: "Company" },
                      { title: "Buyer" },
                      { title: "Total", alignment: "end" },
                      { title: "Received" },
                      { title: "Expires" },
                      { title: "Status" },
                    ]}
                  >
                    {rows}
                  </IndexTable>
                )}
              </div>
              {!isOffers && pageInfo.pages > 1 && (
                <Box padding="300">
                  <Pagination
                    hasPrevious={pageInfo.hasPrev}
                    hasNext={pageInfo.hasNext}
                    onPrevious={() => go({ page: pageInfo.page - 1 })}
                    onNext={() => go({ page: pageInfo.page + 1 })}
                    label={`Page ${pageInfo.page} of ${pageInfo.pages}`}
                  />
                </Box>
              )}
            </>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

function InlineStackLinks() {
  return (
    <BlockStack gap="0">
      <Text as="p" tone="subdued">
        Open an offer to counter, accept or decline it. Your margin floor is always respected.{" "}
        <PolarisLink url="/app/offers/rules">Offer rules</PolarisLink> ·{" "}
        <PolarisLink url="/app/offers/widget">Storefront widget</PolarisLink>
      </Text>
    </BlockStack>
  );
}

type OfferRow = {
  id: string;
  buyerEmail: string;
  source: string;
  status: OfferStatus;
  listPriceTotal: number;
  offeredTotal: number;
  currentCounterTotal: number | null;
  createdAt: string | Date;
};

/** The Offers view of the Quotes table (Make an Offer). */
function OffersPanel({ unlocked, offers, searching }: { unlocked: boolean; offers: OfferRow[]; searching: boolean }) {
  if (!unlocked) {
    return (
      <Box padding="400">
        <Banner tone="info" title="Let buyers name their price">
          <p>
            Accept, counter or decline price offers from your storefront, with rules that protect your margin.
            Make an Offer is included in Growth (manual answers and rules) and Scale (automatic answers).
            Shoppers don’t see the Make an Offer button until then.
          </p>
          <Box paddingBlockStart="200">
            <Button url={upgradeUrl("growth")} variant="primary">
              See Growth
            </Button>
          </Box>
        </Banner>
      </Box>
    );
  }
  if (offers.length === 0) {
    return (
      <Box padding="600">
        <BlockStack gap="200" inlineAlign="center">
          <Text as="p" fontWeight="semibold">
            {searching ? "No offers match your search" : "No offers yet"}
          </Text>
          <Text as="p" tone="subdued">
            {searching ? "Try a different email." : "Offers land here once the Make an Offer button is on your storefront."}
          </Text>
          {!searching && <Button url="/app/offers/widget">Set up the button</Button>}
        </BlockStack>
      </Box>
    );
  }
  // Offer amounts are the buyer's and your rule's figures, shown as stored.
  return (
    <IndexTable
      resourceName={{ singular: "offer", plural: "offers" }}
      itemCount={offers.length}
      selectable={false}
      headings={[{ title: "Buyer" }, { title: "List price", alignment: "end" }, { title: "Offer", alignment: "end" }, { title: "Received" }, { title: "Status" }]}
    >
      {offers.map((o, i) => (
        <IndexTable.Row id={o.id} key={o.id} position={i}>
          <IndexTable.Cell>
            <PolarisLink url={`/app/offers/${o.id}`} removeUnderline>
              <Text as="span" fontWeight="semibold">
                {o.buyerEmail}
              </Text>
            </PolarisLink>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" alignment="end" numeric>
              {o.listPriceTotal.toFixed(2)}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" alignment="end" numeric>
              {o.offeredTotal.toFixed(2)}
              {o.currentCounterTotal != null ? ` → ${o.currentCounterTotal.toFixed(2)}` : ""}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>{formatDate(o.createdAt)}</IndexTable.Cell>
          <IndexTable.Cell>
            <Badge tone={OFFER_TONE[o.status]}>{titleCase(o.status)}</Badge>
          </IndexTable.Cell>
        </IndexTable.Row>
      ))}
    </IndexTable>
  );
}

// Keep merchant-facing errors as a friendly page, not a raw stack trace.
export function ErrorBoundary() {
  return (
    <Page>
      <TitleBar title="Quotes" />
      <Banner tone="critical" title="We couldn’t load your quotes" action={{ content: "Try again", url: "/app/quotes" }}>
        <p>Your quotes are safe. Reload the page, and if this keeps happening contact Mannon support.</p>
      </Banner>
    </Page>
  );
}
