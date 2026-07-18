import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import { applyAutoExpiry } from "../services/quote.server";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate } from "../lib/format";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const buyerId = await requireBuyerId(request);
  // Ownership: a buyer only sees their own quotes.
  const owned = await prisma.quote.findFirst({
    where: { id: params.id, buyerId },
    select: { id: true },
  });
  if (!owned) throw new Response("Quote not found", { status: 404 });

  await applyAutoExpiry(owned.id);
  const quote = await prisma.quote.findUnique({
    where: { id: owned.id },
    include: { lines: true },
  });
  if (!quote) throw new Response("Quote not found", { status: 404 });

  return {
    quote: {
      status: quote.status,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
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

export default function BuyerQuote() {
  const { quote } = useLoaderData<typeof loader>();
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

      <p>
        <Link to="/portal" className="portal-link">
          ← Back to portal
        </Link>
      </p>
    </section>
  );
}
