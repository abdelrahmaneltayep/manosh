import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Banner, Button, Box, TextField, Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShopCapabilities } from "../services/billing.server";
import { MAKE_AN_OFFER_ENABLED, getOffer, offerSuggestion, counterOffer, acceptOffer, declineOffer, convertOffer } from "../services/offers.server";
import { getCatalog } from "../services/catalog.server";
import { formatDate } from "../lib/format";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  if (caps.makeAnOffer === "teaser") throw redirect("/app/offers");
  const offer = await getOffer(session.shop, params.id!);
  if (!offer) throw new Response("Offer not found", { status: 404 });
  const suggestion = await offerSuggestion(session.shop, offer.id);
  return {
    offer: {
      id: offer.id, buyerEmail: offer.buyerEmail, source: offer.source, status: offer.status,
      listPriceTotal: Number(offer.listPriceTotal), offeredTotal: Number(offer.offeredTotal),
      currentCounterTotal: offer.currentCounterTotal == null ? null : Number(offer.currentCounterTotal),
      marginAtOffer: offer.marginAtOffer == null ? null : Number(offer.marginAtOffer),
      convertedOrderId: offer.convertedOrderId,
      createdAt: offer.createdAt,
      messages: offer.messages.map((m) => ({ id: m.id, actor: m.actor, amountTotal: m.amountTotal == null ? null : Number(m.amountTotal), note: m.note, createdAt: m.createdAt })),
    },
    suggestion,
    isScale: caps.makeAnOffer === "auto",
  };
};

type ActionResult = { ok: boolean; message?: string; error?: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const caps = await getShopCapabilities(session.shop);
  if (caps.makeAnOffer === "teaser") return { ok: false, error: "Upgrade to Growth to handle offers." };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = params.id!;
  if (intent === "counter") {
    const res = await counterOffer(session.shop, id, Number(form.get("amount") ?? 0), String(form.get("note") ?? "") || undefined);
    return res.ok ? { ok: true, message: "Counter sent." } : { ok: false, error: res.error };
  }
  if (intent === "accept") {
    const res = await acceptOffer(session.shop, id);
    return res.ok ? { ok: true, message: "Offer accepted." } : { ok: false, error: res.error };
  }
  if (intent === "decline") {
    const res = await declineOffer(session.shop, id, String(form.get("note") ?? "") || undefined);
    return res.ok ? { ok: true, message: "Offer declined." } : { ok: false, error: res.error };
  }
  if (intent === "convert") {
    if (caps.makeAnOffer !== "auto") return { ok: false, error: "Upgrade to Scale to turn offers into orders automatically." };
    const catalog = await getCatalog(session.shop);
    const currencyCode = catalog[0]?.currencyCode ?? "USD";
    const res = await convertOffer(session.shop, id, admin, { currencyCode });
    return "error" in res ? { ok: false, error: res.error } : { ok: true, message: "Draft order created." };
  }
  return { ok: false, error: "Unknown action." };
};

const SUGGESTION_LABEL: Record<string, string> = {
  accept: "Suggest: accept (margin intact)", decline: "Suggest: decline (below threshold)",
  counter: "Suggest: counter", manual: "Suggest: review manually",
};

export default function OfferDetail() {
  const { offer, suggestion, isScale } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const [counter, setCounter] = useState(
    suggestion?.action === "counter" && suggestion.counterCents ? (suggestion.counterCents / 100).toFixed(2) : offer.offeredTotal.toFixed(2),
  );
  const open = offer.status === "PENDING" || offer.status === "COUNTERED";
  const canConvert = isScale && offer.status === "ACCEPTED" && !offer.convertedOrderId;

  return (
    <Page backAction={{ url: "/app/offers" }}>
      <TitleBar title={`Offer from ${offer.buyerEmail}`} />
      <BlockStack gap="400">
        {actionData?.message && <Banner tone="success">{actionData.message}</Banner>}
        {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{offer.buyerEmail}</Text>
              <Badge tone={offer.status === "ACCEPTED" ? "success" : offer.status === "PENDING" ? "attention" : undefined}>
                {offer.status.charAt(0) + offer.status.slice(1).toLowerCase()}
              </Badge>
            </InlineStack>
            <InlineStack gap="400" wrap>
              <Metric label="List price" value={offer.listPriceTotal.toFixed(2)} />
              <Metric label="Offered" value={offer.offeredTotal.toFixed(2)} />
              {offer.currentCounterTotal != null && <Metric label="Your counter" value={offer.currentCounterTotal.toFixed(2)} />}
              <Metric label="Margin at offer" value={offer.marginAtOffer == null ? "unknown" : `${Math.round(offer.marginAtOffer * 100)}%`} />
            </InlineStack>
            {suggestion && (
              <Banner tone={suggestion.action === "decline" ? "warning" : suggestion.action === "accept" ? "success" : "info"}>
                <b>{SUGGESTION_LABEL[suggestion.action]}</b> — {suggestion.reason}
                {suggestion.action === "counter" && suggestion.counterCents != null && <> (${(suggestion.counterCents / 100).toFixed(2)})</>}
              </Banner>
            )}
            <Text as="p" tone="subdued" variant="bodySm">
              Received {formatDate(offer.createdAt)} · {offer.source.toLowerCase()}
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Negotiation</Text>
            <BlockStack gap="200">
              {offer.messages.map((m) => (
                <Box key={m.id} padding="200" background={m.actor === "MERCHANT" ? "bg-surface-secondary" : undefined} borderRadius="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" fontWeight="semibold">{m.actor.charAt(0) + m.actor.slice(1).toLowerCase()}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">{formatDate(m.createdAt)}</Text>
                  </InlineStack>
                  {m.amountTotal != null && <Text as="p" variant="bodyMd">Amount: {m.amountTotal.toFixed(2)}</Text>}
                  {m.note && <Text as="p" variant="bodySm" tone="subdued">{m.note}</Text>}
                </Box>
              ))}
            </BlockStack>

            {open ? (
              <>
                <Divider />
                <Form method="post">
                  <input type="hidden" name="intent" value="counter" />
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">Respond</Text>
                    <InlineStack gap="300" blockAlign="end" wrap>
                      <Box minWidth="10rem"><TextField label="Counter amount" name="amount" type="number" value={counter} onChange={setCounter} autoComplete="off" prefix="$" /></Box>
                      <Box minWidth="18rem"><TextField label="Note (optional)" name="note" autoComplete="off" /></Box>
                      <Button submit disabled={busy}>Send counter</Button>
                    </InlineStack>
                  </BlockStack>
                </Form>
                <InlineStack gap="200">
                  <Form method="post"><input type="hidden" name="intent" value="accept" /><Button submit variant="primary" disabled={busy}>Accept offer</Button></Form>
                  <Form method="post"><input type="hidden" name="intent" value="decline" /><Button submit tone="critical" disabled={busy}>Decline</Button></Form>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  Once accepted, Scale can convert it to a native draft order (net-terms / deposit). Totals are always Shopify's.
                </Text>
              </>
            ) : offer.convertedOrderId ? (
              <>
                <Divider />
                <Banner tone="success">Converted to a draft order. Totals are Shopify’s — finish it in Orders → Drafts.</Banner>
              </>
            ) : canConvert ? (
              <>
                <Divider />
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Turn this into an order</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Creates a native draft order at the agreed price on the buyer’s company location. Shopify calculates tax and the total — we never compute money.
                  </Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="convert" />
                    <Button submit variant="primary" disabled={busy}>Convert to draft order</Button>
                  </Form>
                </BlockStack>
              </>
            ) : (
              <Text as="p" tone="subdued" variant="bodyMd">This offer is closed ({offer.status.toLowerCase()}).</Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="050">
      <Text as="span" tone="subdued" variant="bodySm">{label}</Text>
      <Text as="span" variant="headingLg">{value}</Text>
    </BlockStack>
  );
}
