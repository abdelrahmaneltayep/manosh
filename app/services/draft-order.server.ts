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
  lineItems: Array<{
    variantId: string;
    quantity: number;
    priceOverride: { amount: string; currencyCode: string };
  }>;
  poNumber?: string;
  paymentTerms?: { paymentTermsTemplateId: string };
  /** F14: when true, Shopify zeroes tax on the draft order (verified-exempt buyer). */
  taxExempt?: boolean;
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
  /** F14: pass true for a verified-exempt buyer — Shopify removes tax (we never compute it). */
  taxExempt?: boolean;
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
  };
  if (params.poReference) {
    input.poNumber = params.poReference;
  }
  if (params.paymentTermsTemplateId) {
    input.paymentTerms = { paymentTermsTemplateId: params.paymentTermsTemplateId };
  }
  if (params.taxExempt) {
    input.taxExempt = true;
  }
  return input;
}

interface MoneySet {
  shopMoney?: { amount?: string; currencyCode?: string };
}
interface CalculatedShape {
  subtotalPriceSet?: MoneySet;
  totalTaxSet?: MoneySet;
  totalPriceSet?: MoneySet;
}

function readTotals(node: CalculatedShape): DraftOrderTotals {
  const subtotal = node.subtotalPriceSet?.shopMoney;
  const tax = node.totalTaxSet?.shopMoney;
  const total = node.totalPriceSet?.shopMoney;
  return {
    subtotal: subtotal?.amount ?? "0.00",
    totalTax: tax?.amount ?? "0.00",
    total: total?.amount ?? "0.00",
    currencyCode: total?.currencyCode ?? subtotal?.currencyCode ?? "USD",
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
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
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
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
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

/** Preview real tax/totals for a draft order (source of truth for money). */
export async function calculateDraftOrder(
  admin: AdminGraphqlClient,
  input: DraftOrderInput,
): Promise<DraftOrderTotals> {
  const payload = await runMutation<Parameters<typeof mapCalculatedTotals>[0]>(
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
  const payload = await runMutation<Parameters<typeof mapCreatedDraftOrder>[0]>(
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
