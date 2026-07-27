import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { getBuyerId } from "../services/buyer-session.server";
import { listInvoicesForCompany } from "../services/invoice.server";
import { formatDate } from "../lib/format";

// Buyer invoices list. Session-gated by magic-link. Shows open invoices + due
// dates; each links to a printable invoice ("download PDF" via the browser).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const buyerId = await getBuyerId(request);
  if (!buyerId) throw redirect("/portal/signin");
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { company: true },
  });
  if (!buyer) throw redirect("/portal/signin");

  const invoices = await listInvoicesForCompany(buyer.companyId);
  return {
    company: buyer.company.name,
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.id.slice(-8).toUpperCase(),
      amount: i.amount.toString(),
      currency: i.currency,
      status: i.status,
      dueDate: i.dueDate,
    })),
  };
};

export default function PortalInvoices() {
  const { company, invoices } = useLoaderData<typeof loader>();
  return (
    <section className="portal-card">
      <h1>Invoices</h1>
      <p className="muted">{company}</p>

      {invoices.length === 0 ? (
        <p className="muted">You have no invoices yet.</p>
      ) : (
        <ul className="quote-list">
          {invoices.map((inv) => (
            <li key={inv.id} className="quote-list-row">
              <span>
                <Link to={`/portal/invoices/${inv.id}`} className="portal-link">
                  Invoice #{inv.number}
                </Link>
                <span className="muted">
                  {" "}
                  · {inv.currency} {Number(inv.amount).toFixed(2)} · due {formatDate(inv.dueDate)}
                </span>
              </span>
              <span className={`status-pill status-${inv.status.toLowerCase()}`}>
                {inv.status.charAt(0) + inv.status.slice(1).toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        <Link to="/portal" className="portal-link">
          ← Back to your portal
        </Link>
      </p>
    </section>
  );
}
