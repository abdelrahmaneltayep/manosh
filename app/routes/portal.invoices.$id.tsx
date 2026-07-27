import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { getBuyerId } from "../services/buyer-session.server";
import { getInvoiceForCompany } from "../services/invoice.server";
import { formatDate } from "../lib/format";

// Printable single invoice. "Download PDF" uses the browser's print-to-PDF
// (window.print) so we ship no PDF dependency; print CSS hides the chrome.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const buyerId = await getBuyerId(request);
  if (!buyerId) throw redirect("/portal/signin");
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { company: true },
  });
  if (!buyer) throw redirect("/portal/signin");

  const invoice = await getInvoiceForCompany(params.id!, buyer.companyId);
  if (!invoice) throw new Response("Invoice not found", { status: 404 });

  return {
    company: buyer.company.name,
    buyerName: buyer.name,
    invoice: {
      number: invoice.id.slice(-8).toUpperCase(),
      amount: invoice.amount.toString(),
      currency: invoice.currency,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      poReference: null as string | null,
    },
  };
};

export default function PortalInvoice() {
  const { company, buyerName, invoice } = useLoaderData<typeof loader>();
  return (
    <section className="portal-card invoice-sheet">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
          .portal-brand { display: none; }
        }
        .invoice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
        .invoice-total { font-size: 1.6rem; font-weight: 700; margin-top: 0.5rem; }
        .invoice-meta dt { color: var(--muted); font-size: 0.85rem; }
        .invoice-meta dd { margin: 0 0 0.5rem; font-weight: 600; }
      `}</style>

      <div className="quote-head">
        <h1>Invoice #{invoice.number}</h1>
        <span className={`status-pill status-${invoice.status.toLowerCase()}`}>
          {invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase()}
        </span>
      </div>

      <div className="invoice-grid">
        <dl className="invoice-meta">
          <dt>Billed to</dt>
          <dd>
            {company}
            {buyerName ? ` · ${buyerName}` : ""}
          </dd>
          <dt>Issued</dt>
          <dd>{formatDate(invoice.issuedAt)}</dd>
        </dl>
        <dl className="invoice-meta">
          <dt>Due date</dt>
          <dd>{formatDate(invoice.dueDate)}</dd>
          <dt>Amount due</dt>
          <dd className="invoice-total">
            {invoice.currency} {Number(invoice.amount).toFixed(2)}
          </dd>
        </dl>
      </div>

      <p className="muted">
        Amounts are calculated and settled by the store on Shopify. This document
        is a summary of your net-terms invoice.
      </p>

      <p className="portal-actions no-print" style={{ marginTop: "1.5rem" }}>
        <button
          type="button"
          className="portal-button"
          onClick={() => window.print()}
        >
          Download PDF
        </button>
        <Link to="/portal/invoices" className="portal-link">
          ← All invoices
        </Link>
      </p>
    </section>
  );
}
