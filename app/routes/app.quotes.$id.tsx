import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate } from "../lib/format";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const quote = await getQuoteDetailForShop(session.shop, params.id!);
  if (!quote) {
    throw new Response("Quote not found", { status: 404 });
  }
  return {
    quote: {
      id: quote.id,
      status: quote.status,
      companyName: quote.company.name,
      buyerEmail: quote.buyer.email,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      poReference: quote.poReference,
      draftOrderId: quote.draftOrderId,
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
  const { session } = await authenticate.admin(request);
  const quoteId = params.id!;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "decline") {
      await declineQuoteForShop(session.shop, quoteId);
      return { ok: true as const, message: "Quote declined." };
    }

    if (intent === "counter") {
      const parsed = parseCounterForm(form);
      if (!parsed.ok) {
        return { ok: false as const, error: parsed.error };
      }
      await counterQuoteForShop(session.shop, quoteId, parsed.lines);
      return { ok: true as const, message: "Counter sent to the buyer." };
    }

    return { ok: false as const, error: "Unknown action." };
  } catch (error) {
    if (error instanceof QuoteNotFoundError) {
      throw new Response("Quote not found", { status: 404 });
    }
    if (error instanceof IllegalQuoteTransitionError) {
      return {
        ok: false as const,
        error:
          intent === "decline"
            ? "This quote can no longer be declined."
            : "This quote can no longer be countered — it may have been accepted or expired.",
      };
    }
    throw error;
  }
};

export default function QuoteDetail() {
  const { quote } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const badge = quoteStatusBadge(quote.status);
  const isSubmitted = quote.status === "SUBMITTED";
  const isTerminal = quote.status === "ORDERED" || quote.status === "EXPIRED";

  const [lines, setLines] = useState(() =>
    quote.lines.map((line) => ({
      ...line,
      priceInput: line.price,
      quantityInput: String(line.quantity),
    })),
  );

  const setLine = (id: string, field: "priceInput" | "quantityInput", value: string) =>
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );

  return (
    <Page
      backAction={{ content: "Quotes", url: "/app/quotes" }}
      title={quote.companyName}
      titleMetadata={<Badge tone={badge.tone}>{badge.label}</Badge>}
      subtitle={quote.buyerEmail}
    >
      <TitleBar title="Quote" />
      <BlockStack gap="400">
        {actionData && !actionData.ok && (
          <Banner tone="critical" title="Couldn’t update this quote">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {actionData && actionData.ok && (
          <Banner tone="success" title={actionData.message} />
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
                <BlockStack gap="300">
                  {lines.map((line) => (
                    <div key={line.id}>
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
                    </div>
                  ))}
                  <InlineStack gap="200">
                    <Button variant="primary" submit loading={submitting}>
                      Send counter
                    </Button>
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
                      {line.quantity} × ${line.price}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {!isSubmitted && !isTerminal && (
          <Text as="p" tone="subdued">
            You’ve countered this quote. It’s now with the buyer to accept.
          </Text>
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
