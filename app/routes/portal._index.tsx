import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { getBuyerId } from "../services/buyer-session.server";
import { isExpired } from "../services/quote.server";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate } from "../lib/format";

// Buyer home. Session-gated: no valid session → sign-in notice. Shows a way to
// request a quote plus the buyer's existing quotes. Reorder cards (S9),
// quick-order (S10), and accept (S8) build on this.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const buyerId = await getBuyerId(request);
  if (!buyerId) throw redirect("/portal/signin");

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: {
      company: true,
      quotes: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!buyer) throw redirect("/portal/signin");

  const now = new Date();
  return {
    email: buyer.email,
    name: buyer.name,
    company: buyer.company.name,
    quotes: buyer.quotes.map((quote) => ({
      id: quote.id,
      displayStatus: isExpired(quote, now) ? "EXPIRED" : quote.status,
      createdAt: quote.createdAt,
    })),
  };
};

export default function PortalHome() {
  const { email, name, company, quotes } = useLoaderData<typeof loader>();
  return (
    <section className="portal-card">
      <h1>Welcome{name ? `, ${name}` : ""}</h1>
      <p className="muted">
        Signed in as {email} · {company}
      </p>

      <p>
        <Link to="/portal/quotes/new" className="portal-button">
          Request a quote
        </Link>
      </p>

      <h2 className="portal-subhead">Your quotes</h2>
      {quotes.length === 0 ? (
        <p className="muted">
          You haven’t requested any quotes yet. Start one above.
        </p>
      ) : (
        <ul className="quote-list">
          {quotes.map((quote) => {
            const badge = quoteStatusBadge(
              quote.displayStatus as Parameters<typeof quoteStatusBadge>[0],
            );
            return (
              <li key={quote.id} className="quote-list-row">
                <Link to={`/portal/quotes/${quote.id}`} className="portal-link">
                  Quote from {formatDate(quote.createdAt)}
                </Link>
                <span
                  className={`status-pill status-${quote.displayStatus.toLowerCase()}`}
                >
                  {badge.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <Form method="post" action="/portal/logout" style={{ marginTop: "1.5rem" }}>
        <button type="submit" className="portal-link-button">
          Sign out
        </button>
      </Form>
    </section>
  );
}
