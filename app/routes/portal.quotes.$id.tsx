import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import {
  applyAutoExpiry,
  IllegalQuoteTransitionError,
  QuoteNotFoundError,
} from "../services/quote.server";
import { acceptAndOrder } from "../services/quote-accept.server";
import { DraftOrderError } from "../services/draft-order.server";
import { getCatalog } from "../services/catalog.server";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate } from "../lib/format";

interface TotalsSnapshot {
  subtotal: string;
  totalTax: string;
  total: string;
  currencyCode: string;
}

async function ownedQuoteId(request: Request, id: string | undefined) {
  const buyerId = await requireBuyerId(request);
  const owned = await prisma.quote.findFirst({
    where: { id, buyerId },
    select: { id: true },
  });
  if (!owned) throw new Response("Quote not found", { status: 404 });
  return owned.id;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const quoteId = await ownedQuoteId(request, params.id);
  await applyAutoExpiry(quoteId);
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true },
  });
  if (!quote) throw new Response("Quote not found", { status: 404 });

  return {
    quote: {
      status: quote.status,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      totals: quote.totalsSnapshot as TotalsSnapshot | null,
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
  const quoteId = await ownedQuoteId(request, params.id);
  const buyer = await prisma.quote
    .findUnique({
      where: { id: quoteId },
      include: { company: { include: { shop: true } } },
    })
    .then((q) => q?.company.shop.shopifyDomain);
  if (!buyer) throw new Response("Quote not found", { status: 404 });

  try {
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(buyer);
    const catalog = await getCatalog(buyer);
    const currencyCode = catalog[0]?.currencyCode ?? "USD";
    await acceptAndOrder(quoteId, admin, { currencyCode });
    return redirect(`/portal/quotes/${quoteId}`);
  } catch (error) {
    if (
      error instanceof DraftOrderError ||
      error instanceof IllegalQuoteTransitionError ||
      error instanceof QuoteNotFoundError
    ) {
      return {
        error:
          error instanceof DraftOrderError
            ? error.message
            : "This quote can no longer be accepted.",
      };
    }
    return {
      error: "We couldn’t create your order just now. Please try again.",
    };
  }
};

export default function BuyerQuote() {
  const { quote } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const status = quoteStatusBadge(quote.status);

  return (
    <section className="portal-card">
      <div className="quote-head">
        <h1>Your quote request</h1>
        <span className={`status-pill status-${quote.status.toLowerCase()}`}>
          {status.label}
        </span>
      </div>
      <p className="muted">
        Sent {formatDate(quote.createdAt)} · Expires {formatDate(quote.expiresAt)}
      </p>

      {actionData?.error && (
        <p className="error" role="alert">
          {actionData.error}
        </p>
      )}

      <ul className="catalog-list">
        {quote.lines.map((line) => (
          <li key={line.id} className="catalog-row">
            <div className="catalog-info">
              <span className="catalog-title">{line.title}</span>
              {line.sku && <span className="muted"> · {line.sku}</span>}
            </div>
            <span className="muted">
              {line.quantity} × {line.price}
            </span>
          </li>
        ))}
      </ul>

      {quote.status === "COUNTERED" && (
        <Form method="post">
          <input type="hidden" name="intent" value="accept" />
          <button type="submit" className="portal-button" disabled={submitting}>
            {submitting ? "Creating order…" : "Accept & create order"}
          </button>
        </Form>
      )}

      {quote.totals && (
        <div className="totals" aria-label="Order totals">
          <div className="totals-row">
            <span>Subtotal</span>
            <span>
              {quote.totals.currencyCode} {quote.totals.subtotal}
            </span>
          </div>
          <div className="totals-row">
            <span>Tax</span>
            <span>
              {quote.totals.currencyCode} {quote.totals.totalTax}
            </span>
          </div>
          <div className="totals-row totals-total">
            <span>Total</span>
            <span>
              {quote.totals.currencyCode} {quote.totals.total}
            </span>
          </div>
        </div>
      )}

      <p>
        <Link to="/portal" className="portal-link">
          ← Back to portal
        </Link>
      </p>
    </section>
  );
}
