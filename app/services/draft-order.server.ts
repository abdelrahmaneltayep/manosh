/**
 * Shopify draft order wrappers (S8). We create/price orders on native draft
 * orders and NEVER compute tax/discounts/totals ourselves — `draftOrderCalculate`
 * and the created draft order are the single source of truth for money. We only
 * snapshot what Shopify returns.
 *
 * The admin GraphQL client is injected, so the request-building and
 * response-mapping are unit-testable against a mocked Admin API. Confirm the
 * exact DraftOrderInput / purchasingEntity / priceOverride field names and the
 * calculated-order price fields against the current API via the Shopify Dev MCP.
 */

import { adjustmentDraftFields, type QuoteAdjustments } from "../lib/quote-adjustments";

export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
}

export interface DraftOrderTotals {
  subtotal: string;
  totalTax: string;
  total: string;
  currencyCode: string;
  /** Shopify's total discounts and shipping, when the quote has them. */
  totalDiscounts?: string;
  totalShipping?: string;
  /** When Shopify calculated these (ISO), set where a snapshot is saved. */
  calculatedAt?: string;
}

export interface PurchasingEntityRef {
  companyId: string;
  companyLocationId: string;
  companyContactId: string | null;
}

export interface DraftLineInput {
  variantId: string;
  quantity: number;
  /** Agreed unit price (money as a string). */
  price: string;
}

export interface DraftOrderInput {
  purchasingEntity: {
    purchasingCompany: {
      companyId: string;
      companyLocationId: string;
      companyContactId?: string;
    };
  };
  lineItems: Array<
    | { variantId: string; quantity: number; priceOverride: { amount: string; currencyCode: string } }
    // A custom item (no product): Shopify takes a title and an original unit price.
    | { title: string; quantity: number; originalUnitPriceWithCurrency: { amount: string; currencyCode: string } }
  >;
  /** An order discount; Shopify calculates the amount. */
  appliedDiscount?: { valueType: "PERCENTAGE" | "FIXED_AMOUNT"; value: number; title?: string };
  /** A shipping line at the price the merchant set. */
  shippingLine?: { title: string; priceWithCurrency: { amount: string; currencyCode: string } };
  poNumber?: string;
  /**
   * Native payment terms. Shopify needs a schedule with the template: NET
   * terms take `issuedAt` (the invoice date the net days count from), FIXED
   * terms take `dueAt`; on-receipt and on-fulfillment take none.
   */
  paymentTerms?: {
    paymentTermsTemplateId: string;
    paymentSchedules?: Array<{ issuedAt?: string; dueAt?: string }>;
  };
  /** F14: when true, Shopify zeroes tax on the draft order (verified-exempt buyer). */
  taxExempt?: boolean;
  /** Tags on the draft order; a quote's draft carries mannon-quote:<quote id>. */
  tags?: string[];
  /**
   * The currency the draft is priced and charged in. Set to the agreed
   * (priceOverride) currency: otherwise a company location in another market
   * (e.g. Canada) converts the override and applies the market's price
   * rounding, so the buyer is charged more than the quoted unit prices.
   */
  presentmentCurrencyCode?: string;
}

export class DraftOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftOrderError";
  }
}

/**
 * Build the DraftOrderInput from a quote's lines + the buyer's purchasing
 * entity. `priceOverride` carries the agreed unit price (not a computation) —
 * Shopify then calculates tax and totals on top.
 */
export function buildDraftOrderInput(params: {
  lines: DraftLineInput[];
  currencyCode: string;
  purchasingEntity: PurchasingEntityRef;
  poReference?: string | null;
  /** Native payment terms template to attach (display + attach only). */
  paymentTermsTemplateId?: string | null;
  /**
   * The template's type and net days (from paymentTermsTemplates), so the
   * schedule Shopify requires can be attached. Without it only the template id
   * is sent, which Shopify rejects for NET terms ("An issue date is required").
   */
  paymentTerm?: { paymentTermsType: string; dueInDays: number | null } | null;
  /** Issue date for NET terms; defaults to now. */
  now?: Date;
  /** F14: pass true for a verified-exempt buyer — Shopify removes tax (we never compute it). */
  taxExempt?: boolean;
  /** Discount, shipping and custom items from the quote (Shopify calculates them). */
  adjustments?: QuoteAdjustments | null;
}): DraftOrderInput {
  const input: DraftOrderInput = {
    purchasingEntity: {
      purchasingCompany: {
        companyId: params.purchasingEntity.companyId,
        companyLocationId: params.purchasingEntity.companyLocationId,
        ...(params.purchasingEntity.companyContactId
          ? { companyContactId: params.purchasingEntity.companyContactId }
          : {}),
      },
    },
    lineItems: params.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      priceOverride: { amount: line.price, currencyCode: params.currencyCode },
    })),
    presentmentCurrencyCode: params.currencyCode,
  };
  if (params.adjustments) {
    const extra = adjustmentDraftFields(params.adjustments, params.currencyCode);
    input.lineItems.push(...extra.customLineItems);
    if (extra.appliedDiscount) input.appliedDiscount = extra.appliedDiscount;
    if (extra.shippingLine) input.shippingLine = extra.shippingLine;
  }
  if (params.poReference) {
    input.poNumber = params.poReference;
  }
  if (params.paymentTermsTemplateId) {
    input.paymentTerms = {
      paymentTermsTemplateId: params.paymentTermsTemplateId,
      ...paymentSchedulesFor(params.paymentTerm, params.now ?? new Date()),
    };
  }
  if (params.taxExempt) {
    input.taxExempt = true;
  }
  return input;
}

/**
 * The payment schedule a template type needs. Pure. NET → issuedAt now; FIXED →
 * dueAt now + dueInDays (a FIXED template without days can't be attached
 * without a date the buyer never chose, so it throws a plain DraftOrderError);
 * RECEIPT / FULFILLMENT / unknown → nothing beyond the template id.
 */
export function paymentSchedulesFor(
  term: { paymentTermsType: string; dueInDays: number | null } | null | undefined,
  now: Date,
): { paymentSchedules?: Array<{ issuedAt?: string; dueAt?: string }> } {
  if (!term) return {};
  const type = term.paymentTermsType.toUpperCase();
  if (type === "NET") return { paymentSchedules: [{ issuedAt: now.toISOString() }] };
  if (type === "FIXED") {
    if (term.dueInDays == null) {
      throw new DraftOrderError(
        "These payment terms need a fixed due date, which can't be set here. Please pick net or on-receipt terms, or leave the account default.",
      );
    }
    const due = new Date(now.getTime() + term.dueInDays * 24 * 60 * 60 * 1000);
    return { paymentSchedules: [{ dueAt: due.toISOString() }] };
  }
  return {};
}

interface MoneySet {
  shopMoney?: { amount?: string; currencyCode?: string };
  presentmentMoney?: { amount?: string; currencyCode?: string };
}
interface CalculatedShape {
  subtotalPriceSet?: MoneySet;
  totalTaxSet?: MoneySet;
  totalPriceSet?: MoneySet;
  totalDiscountsSet?: MoneySet;
  totalShippingPriceSet?: MoneySet;
}

/**
 * Snapshot the amounts the buyer is charged. For a multi-currency draft
 * Shopify's presentment money is the source of truth and shop money only an
 * estimate in the shop currency, so prefer presentment and fall back to shop.
 */
function readTotals(node: CalculatedShape): DraftOrderTotals {
  const pick = (set?: MoneySet) => (set?.presentmentMoney?.amount ? set.presentmentMoney : set?.shopMoney);
  const subtotal = pick(node.subtotalPriceSet);
  const tax = pick(node.totalTaxSet);
  const total = pick(node.totalPriceSet);
  const discounts = pick(node.totalDiscountsSet)?.amount;
  const shipping = pick(node.totalShippingPriceSet)?.amount;
  return {
    subtotal: subtotal?.amount ?? "0.00",
    totalTax: tax?.amount ?? "0.00",
    total: total?.amount ?? "0.00",
    currencyCode: total?.currencyCode ?? subtotal?.currencyCode ?? "USD",
    ...(discounts && Number(discounts) !== 0 ? { totalDiscounts: discounts } : {}),
    ...(shipping && Number(shipping) !== 0 ? { totalShipping: shipping } : {}),
  };
}

interface UserError {
  field?: string[] | null;
  message: string;
}

function assertNoUserErrors(errors: UserError[] | undefined, op: string): void {
  if (errors && errors.length > 0) {
    throw new DraftOrderError(
      `${op} failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
}

/** Pure: map a draftOrderCalculate payload to a totals snapshot. */
export function mapCalculatedTotals(payload: {
  calculatedDraftOrder?: CalculatedShape | null;
  userErrors?: UserError[];
}): DraftOrderTotals {
  assertNoUserErrors(payload.userErrors, "draftOrderCalculate");
  if (!payload.calculatedDraftOrder) {
    throw new DraftOrderError("draftOrderCalculate returned no order");
  }
  return readTotals(payload.calculatedDraftOrder);
}

/** Pure: map a draftOrderCreate payload to the created id + totals snapshot. */
export function mapCreatedDraftOrder(payload: {
  draftOrder?: (CalculatedShape & { id?: string }) | null;
  userErrors?: UserError[];
}): { id: string; totals: DraftOrderTotals } {
  assertNoUserErrors(payload.userErrors, "draftOrderCreate");
  if (!payload.draftOrder?.id) {
    throw new DraftOrderError("draftOrderCreate returned no draft order");
  }
  return { id: payload.draftOrder.id, totals: readTotals(payload.draftOrder) };
}

const DRAFT_ORDER_CALCULATE = `#graphql
  mutation MannonDraftOrderCalculate($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }
`;

const DRAFT_ORDER_CREATE = `#graphql
  mutation MannonDraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }
`;

async function runMutation<T>(
  admin: AdminGraphqlClient,
  query: string,
  input: DraftOrderInput,
  key: "draftOrderCalculate" | "draftOrderCreate",
): Promise<T> {
  const response = await admin.graphql(query, { variables: { input } });
  const body = (await response.json()) as { data?: Record<string, T> };
  const payload = body.data?.[key];
  if (!payload) {
    throw new DraftOrderError(`${key} returned no response`);
  }
  return payload;
}

/** True when Shopify rejected the requested presentment currency. Pure. */
export function rejectsPresentmentCurrency(errors: UserError[] | undefined): boolean {
  return (errors ?? []).some(
    (e) =>
      (e.field ?? []).some((f) => /presentmentCurrencyCode/i.test(f)) || /presentment currency/i.test(e.message),
  );
}

/**
 * Run a draft-order mutation asking for the agreed currency. If Shopify won't
 * present the draft in it (the location's market doesn't allow it), retry once
 * without, so the order still goes through and the snapshot shows the currency
 * Shopify will actually charge.
 */
async function runWithPresentmentFallback<T extends { userErrors?: UserError[] }>(
  admin: AdminGraphqlClient,
  query: string,
  input: DraftOrderInput,
  key: "draftOrderCalculate" | "draftOrderCreate",
): Promise<T> {
  const payload = await runMutation<T>(admin, query, input, key);
  if (input.presentmentCurrencyCode && rejectsPresentmentCurrency(payload.userErrors)) {
    console.warn("[draft-order] %s refused presentment currency %s; retrying in the market currency", key, input.presentmentCurrencyCode);
    const { presentmentCurrencyCode: _omit, ...rest } = input;
    return runMutation<T>(admin, query, rest, key);
  }
  return payload;
}

/** Preview real tax/totals for a draft order (source of truth for money). */
export async function calculateDraftOrder(
  admin: AdminGraphqlClient,
  input: DraftOrderInput,
): Promise<DraftOrderTotals> {
  const payload = await runWithPresentmentFallback<Parameters<typeof mapCalculatedTotals>[0]>(
    admin,
    DRAFT_ORDER_CALCULATE,
    input,
    "draftOrderCalculate",
  );
  return mapCalculatedTotals(payload);
}

/** Create the draft order; returns its id and totals snapshot. */
export async function createDraftOrder(
  admin: AdminGraphqlClient,
  input: DraftOrderInput,
): Promise<{ id: string; totals: DraftOrderTotals }> {
  const payload = await runWithPresentmentFallback<Parameters<typeof mapCreatedDraftOrder>[0]>(
    admin,
    DRAFT_ORDER_CREATE,
    input,
    "draftOrderCreate",
  );
  return mapCreatedDraftOrder(payload);
}

const DRAFT_ORDER_INVOICE_SEND = `#graphql
  mutation MannonDraftOrderInvoiceSend($id: ID!) {
    draftOrderInvoiceSend(id: $id) {
      draftOrder { id }
      userErrors { field message }
    }
  }
`;

/**
 * Email the buyer the draft order's invoice (F25.2). Shopify owns the email +
 * the hosted invoice/checkout link; we only trigger the send. Throws
 * DraftOrderError on a userError so callers can treat it as best-effort.
 */
export async function sendDraftOrderInvoice(admin: AdminGraphqlClient, draftOrderId: string): Promise<void> {
  const response = await admin.graphql(DRAFT_ORDER_INVOICE_SEND, { variables: { id: draftOrderId } });
  const body = (await response.json()) as { data?: { draftOrderInvoiceSend?: { userErrors?: UserError[] } } };
  assertNoUserErrors(body.data?.draftOrderInvoiceSend?.userErrors, "draftOrderInvoiceSend");
}

const DRAFT_ORDER_STATUS = `#graphql
  query MannonDraftOrderStatus($id: ID!) {
    draftOrder(id: $id) {
      id
      name
      status
      invoiceSentAt
      order { id name displayFinancialStatus }
    }
  }
`;

export interface DraftOrderStatusView {
  id: string;
  /** Shopify's draft order name, e.g. "#D12". */
  name: string;
  status: "OPEN" | "INVOICE_SENT" | "COMPLETED";
  invoiceSentAt: string | null;
  /** The order the draft became once paid or completed. */
  order: { id: string; name: string; financialStatus: string | null } | null;
}

/** Shopify's own status for a draft order and its order. Null if Shopify can't say. */
export async function getDraftOrderStatus(admin: AdminGraphqlClient, draftOrderId: string): Promise<DraftOrderStatusView | null> {
  const response = await admin.graphql(DRAFT_ORDER_STATUS, { variables: { id: draftOrderId } });
  const body = (await response.json()) as {
    data?: { draftOrder?: { id: string; name: string; status: DraftOrderStatusView["status"]; invoiceSentAt: string | null; order: { id: string; name: string; displayFinancialStatus: string | null } | null } | null };
  };
  const d = body.data?.draftOrder;
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    status: d.status,
    invoiceSentAt: d.invoiceSentAt,
    order: d.order ? { id: d.order.id, name: d.order.name, financialStatus: d.order.displayFinancialStatus } : null,
  };
}

// --- one draft order per quote ------------------------------------------------

/** The tag that ties a Shopify draft order to its quote. */
export function quoteDraftTag(quoteId: string): string {
  return `mannon-quote:${quoteId}`;
}

const DRAFT_ORDER_BY_TAG = `#graphql
  query MannonDraftOrderByTag($query: String!) {
    draftOrders(first: 1, query: $query) {
      nodes {
        id
        subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      }
    }
  }
`;

/** The draft order Shopify already holds for this quote, if any. */
export async function findDraftOrderForQuote(
  admin: AdminGraphqlClient,
  quoteId: string,
): Promise<{ id: string; totals: DraftOrderTotals } | null> {
  const response = await admin.graphql(DRAFT_ORDER_BY_TAG, { variables: { query: `tag:'${quoteDraftTag(quoteId)}'` } });
  const body = (await response.json()) as { data?: { draftOrders?: { nodes?: Array<CalculatedShape & { id: string }> } } };
  const node = body.data?.draftOrders?.nodes?.[0];
  return node?.id ? { id: node.id, totals: readTotals(node) } : null;
}

/**
 * Create the quote's draft order, or reuse the one Shopify already has. If an
 * earlier attempt got as far as Shopify creating the draft but Mannon never
 * saved its id (a crash, a timeout), the retry finds it by tag instead of
 * creating a second one. The search runs after the quote's order claim, and
 * a claim only goes stale after minutes, longer than Shopify takes to index a
 * new draft.
 */
export async function createDraftOrderForQuote(
  admin: AdminGraphqlClient,
  quoteId: string,
  input: DraftOrderInput,
): Promise<{ id: string; totals: DraftOrderTotals; reused: boolean }> {
  const existing = await findDraftOrderForQuote(admin, quoteId);
  if (existing) return { ...existing, reused: true };
  const tag = quoteDraftTag(quoteId);
  const created = await createDraftOrder(admin, { ...input, tags: [...(input.tags ?? []).filter((t) => t !== tag), tag] });
  return { ...created, reused: false };
}
