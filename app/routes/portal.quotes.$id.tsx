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
import { getPaymentTerms, type PaymentTerm } from "../services/payment-terms.server";
import {
  estimateQuoteAmount,
  getApprovalForQuote,
  ensurePendingApproval,
  decideApproval,
} from "../services/approvals.server";
import { needsApproval, canApprove, type CompanyRole } from "../lib/company-accounts";
import { quoteStatusBadge } from "../lib/quote-status";
import { formatDate } from "../lib/format";

const ACCOUNTS_ENABLED = () => process.env.MANNON_FF_COMPANY_ACCOUNTS === "true";

interface TotalsSnapshot {
  subtotal: string;
  totalTax: string;
  total: string;
  currencyCode: string;
}

/** The current member's quote scoped to their COMPANY (any member can view). */
async function memberAndQuote(request: Request, id: string | undefined) {
  const buyerId = await requireBuyerId(request);
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { id: true, role: true, companyId: true },
  });
  if (!buyer) throw new Response("Quote not found", { status: 404 });
  const owned = await prisma.quote.findFirst({
    where: { id, companyId: buyer.companyId },
    select: { id: true },
  });
  if (!owned) throw new Response("Quote not found", { status: 404 });
  return { buyer, quoteId: owned.id };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { buyer, quoteId } = await memberAndQuote(request, params.id);
  await applyAutoExpiry(quoteId);
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true, company: { include: { shop: true } } },
  });
  if (!quote) throw new Response("Quote not found", { status: 404 });

  // Surface native payment terms on the quote (only fetch when there's an
  // action to take — the accept step).
  let paymentTerms: PaymentTerm[] = [];
  if (quote.status === "COUNTERED") {
    try {
      paymentTerms = await getPaymentTerms(quote.company.shop.shopifyDomain);
    } catch {
      paymentTerms = [];
    }
  }

  // F5 — approval state, when company accounts are on and the plan is Growth.
  const accountsOn = ACCOUNTS_ENABLED() && quote.company.shop.plan === "GROWTH";
  const threshold =
    accountsOn && quote.company.approvalThreshold != null
      ? Number(quote.company.approvalThreshold)
      : null;
  const estimated = await estimateQuoteAmount(quoteId);
  const approvalRecord = accountsOn ? await getApprovalForQuote(quoteId) : null;
  const requiresApproval = threshold != null && needsApproval(estimated, threshold);

  return {
    paymentTerms,
    role: buyer.role as CompanyRole,
    approval: {
      enabled: accountsOn,
      requiresApproval,
      estimated,
      threshold,
      status: approvalRecord?.status ?? null,
      id: approvalRecord?.id ?? null,
      canDecide:
        accountsOn && approvalRecord?.status === "PENDING" && canApprove(buyer.role as CompanyRole),
    },
    quote: {
      status: quote.status,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      poReference: quote.poReference,
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
  const { buyer, quoteId } = await memberAndQuote(request, params.id);
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { company: { include: { shop: true } } },
  });
  if (!quote) throw new Response("Quote not found", { status: 404 });
  const shopDomain = quote.company.shop.shopifyDomain;
  const baseUrl = new URL(request.url).origin;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "accept");

  // F5 — approver decision on a pending request.
  if (intent === "approve" || intent === "reject") {
    if (!canApprove(buyer.role)) return { error: "You don’t have permission to approve orders." };
    const approval = await getApprovalForQuote(quoteId);
    if (!approval) return { error: "There’s nothing to approve on this quote." };
    try {
      await decideApproval({
        approvalId: approval.id,
        companyId: buyer.companyId,
        approverId: buyer.id,
        decision: intent === "approve" ? "APPROVED" : "REJECTED",
        baseUrl,
      });
      return { message: intent === "approve" ? "Order approved." : "Order rejected." };
    } catch {
      return { error: "That request was already decided." };
    }
  }

  const poReference = String(form.get("poReference") ?? "").trim() || null;
  const paymentTermsTemplateId = String(form.get("paymentTermsTemplateId") ?? "").trim() || null;

  try {
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(shopDomain);
    const catalog = await getCatalog(shopDomain);
    const currencyCode = catalog[0]?.currencyCode ?? "USD";

    // F5 — spending-approval gate (Growth). If the order reaches the company's
    // threshold, it can't be placed until an approver approves.
    const accountsOn = ACCOUNTS_ENABLED() && quote.company.shop.plan === "GROWTH";
    const threshold = quote.company.approvalThreshold != null ? Number(quote.company.approvalThreshold) : null;
    if (accountsOn && threshold != null) {
      const amount = await estimateQuoteAmount(quoteId);
      if (needsApproval(amount, threshold)) {
        const approval = await getApprovalForQuote(quoteId);
        if (approval?.status === "REJECTED") {
          return { error: "An approver rejected this order, so it can’t be placed." };
        }
        if (approval?.status !== "APPROVED") {
          await ensurePendingApproval({
            quoteId,
            companyId: buyer.companyId,
            requesterId: buyer.id,
            amount,
            currency: currencyCode,
            baseUrl,
          });
          return { approvalPending: true as const };
        }
      }
    }

    // Persist the PO reference so it flows onto the draft order as poNumber.
    await prisma.quote.update({ where: { id: quoteId }, data: { poReference } });
    await acceptAndOrder(quoteId, admin, { currencyCode, paymentTermsTemplateId });
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
  const { quote, paymentTerms, approval } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const status = quoteStatusBadge(quote.status);

  const actionError = actionData && "error" in actionData ? actionData.error : null;
  const actionMessage = actionData && "message" in actionData ? actionData.message : null;
  const justSentForApproval = actionData && "approvalPending" in actionData;

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

      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}
      {actionMessage && <p className="muted" role="status">{actionMessage}</p>}

      {/* F5 — approval state */}
      {approval.enabled && (justSentForApproval || approval.status) && (
        <div className={`quick-order-unresolved`} role="status" style={{ background: "#f2f2fd", borderColor: "#d9d6f7" }}>
          {(justSentForApproval || approval.status === "PENDING") && (
            <p>
              <strong>Waiting for approval.</strong> This order is over your
              company’s approval threshold, so an approver must approve it before
              it can be placed.
            </p>
          )}
          {approval.status === "APPROVED" && (
            <p><strong>Approved.</strong> You can place the order below.</p>
          )}
          {approval.status === "REJECTED" && (
            <p><strong>Rejected.</strong> An approver declined this order.</p>
          )}
          {approval.canDecide && (
            <div className="portal-actions" style={{ marginTop: "0.5rem" }}>
              <Form method="post">
                <input type="hidden" name="intent" value="approve" />
                <button type="submit" className="portal-button portal-button-accept">
                  Approve order
                </button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="reject" />
                <button type="submit" className="portal-link-button">
                  Reject
                </button>
              </Form>
            </div>
          )}
        </div>
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
        <Form method="post" className="accept-form">
          <input type="hidden" name="intent" value="accept" />

          <label className="field">
            <span className="field-label">PO reference (optional)</span>
            <input
              type="text"
              name="poReference"
              defaultValue={quote.poReference ?? ""}
              placeholder="e.g. PO-2026-001"
            />
          </label>

          {paymentTerms.length > 0 && (
            <label className="field">
              <span className="field-label">Payment terms</span>
              <select name="paymentTermsTemplateId" defaultValue="">
                <option value="">Use the account default</option>
                {paymentTerms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </select>
            </label>
          )}

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
