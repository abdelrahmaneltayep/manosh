import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { acceptAndOrder } from "./quote-accept.server";
import { counterQuote, submitQuote, type QuoteWithLines } from "./quote.server";
import type { AdminGraphqlClient } from "./draft-order.server";
import type { CatalogItem } from "./catalog.server";

/**
 * One-click reorder (F2, the revenue feature). A buyer clones a past order into
 * a new quote. If prices haven't moved beyond the shop's auto-approve tolerance
 * the reorder auto-converts straight to a draft order; otherwise it lands in the
 * merchant's inbox as a normal quote to approve.
 */

export interface ReorderCard {
  id: string;
  shopifyOrderId: string;
  orderName: string;
  orderedAt: Date;
  total: string;
  currency: string;
}

export async function listReorderCards(companyId: string): Promise<ReorderCard[]> {
  const sources = await prisma.reorderSource.findMany({
    where: { companyId },
    orderBy: { orderedAt: "desc" },
  });
  return sources.map((s) => ({
    id: s.id,
    shopifyOrderId: s.shopifyOrderId,
    orderName: s.orderName,
    orderedAt: s.orderedAt,
    total: s.total,
    currency: s.currency,
  }));
}

export interface OrderLine {
  variantId: string;
  quantity: number;
  price: string; // original unit price on the past order
  title: string;
  sku: string | null;
}

interface RawOrderData {
  order?: {
    lineItems?: {
      nodes?: Array<{
        quantity: number;
        name?: string;
        sku?: string | null;
        variant?: { id?: string } | null;
        originalUnitPriceSet?: { shopMoney?: { amount?: string } };
      }>;
    };
  } | null;
}

/** Pure: map an Admin `order.lineItems` payload to flat order lines. */
export function mapOrderLines(data: RawOrderData): OrderLine[] {
  const lines: OrderLine[] = [];
  for (const node of data.order?.lineItems?.nodes ?? []) {
    const variantId = node.variant?.id;
    if (!variantId) continue; // custom/deleted line — can't reorder
    lines.push({
      variantId,
      quantity: node.quantity,
      price: node.originalUnitPriceSet?.shopMoney?.amount ?? "0.00",
      title: node.name ?? "",
      sku: node.sku ?? null,
    });
  }
  return lines;
}

const ORDER_LINES_QUERY = `#graphql
  query MannonReorderOrder($id: ID!) {
    order(id: $id) {
      lineItems(first: 100) {
        nodes {
          quantity
          name
          sku
          variant { id }
          originalUnitPriceSet { shopMoney { amount } }
        }
      }
    }
  }
`;

export async function fetchOrderLines(
  admin: AdminGraphqlClient,
  shopifyOrderId: string,
): Promise<OrderLine[]> {
  const response = await admin.graphql(ORDER_LINES_QUERY, {
    variables: { id: shopifyOrderId },
  });
  const body = (await response.json()) as { data?: RawOrderData };
  return mapOrderLines(body.data ?? {});
}

export interface ReorderLine {
  variantId: string;
  sku: string | null;
  title: string;
  quantity: number;
  originalPrice: string;
  currentPrice: string;
}

/**
 * Resolve past-order lines against the current catalog: current price comes
 * from the catalog; a variant no longer in the catalog is flagged unavailable
 * (never silently dropped into the order).
 */
export function buildReorderLines(
  orderLines: OrderLine[],
  catalog: CatalogItem[],
): { lines: ReorderLine[]; unavailable: OrderLine[] } {
  const byVariant = new Map(catalog.map((c) => [c.variantId, c]));
  const lines: ReorderLine[] = [];
  const unavailable: OrderLine[] = [];

  for (const line of orderLines) {
    const item = byVariant.get(line.variantId);
    if (!item) {
      unavailable.push(line);
      continue;
    }
    lines.push({
      variantId: line.variantId,
      sku: item.sku,
      title: item.displayTitle,
      quantity: line.quantity,
      originalPrice: line.price,
      currentPrice: item.price,
    });
  }
  return { lines, unavailable };
}

function relativeDelta(oldPrice: string, newPrice: string): number {
  const o = Number(oldPrice);
  const n = Number(newPrice);
  if (o === 0) return n === 0 ? 0 : Infinity;
  return Math.abs(n - o) / o;
}

/**
 * Pure: does this reorder need merchant approval? Yes if any line's price moved
 * by more than the tolerance fraction. Tolerance 0 ⇒ any price change needs
 * approval.
 */
export function reorderNeedsApproval(
  lines: Array<{ originalPrice: string; currentPrice: string }>,
  tolerance: number,
): boolean {
  return lines.some((line) => relativeDelta(line.originalPrice, line.currentPrice) > tolerance);
}

export interface CreateReorderResult {
  quote: QuoteWithLines;
  autoApproved: boolean;
  needsApproval: boolean;
}

/**
 * Clone reorder lines into a quote at current prices. Within tolerance (and with
 * an admin client to talk to Shopify) it auto-converts through the machine to a
 * draft order; otherwise it stays SUBMITTED for the merchant to review.
 */
export async function createReorder(params: {
  companyId: string;
  buyerId: string;
  lines: ReorderLine[];
  tolerance: number;
  now?: Date;
  autoConvert?: { admin: AdminGraphqlClient; currencyCode: string };
}): Promise<CreateReorderResult> {
  if (params.lines.length === 0) {
    throw new Error("A reorder needs at least one available line.");
  }

  const company = await prisma.company.findUnique({
    where: { id: params.companyId },
    select: { shopId: true },
  });
  if (!company) throw new Error(`Company ${params.companyId} not found`);

  const needsApproval = reorderNeedsApproval(params.lines, params.tolerance);

  const quote = await submitQuote({
    companyId: params.companyId,
    buyerId: params.buyerId,
    now: params.now,
    lines: params.lines.map((line) => ({
      variantId: line.variantId,
      sku: line.sku,
      title: line.title,
      quantity: line.quantity,
      price: line.currentPrice,
    })),
  });

  await appendEvent({
    shopId: company.shopId,
    type: "REORDER_CREATED",
    entityType: "Quote",
    entityId: quote.id,
    payload: { needsApproval, lineCount: params.lines.length },
  });

  if (!needsApproval && params.autoConvert) {
    // Auto-approve: run the machine to a draft order with no merchant step.
    await counterQuote(quote.id, { now: params.now });
    const { quote: ordered } = await acceptAndOrder(quote.id, params.autoConvert.admin, {
      currencyCode: params.autoConvert.currencyCode,
      now: params.now,
    });
    return { quote: ordered, autoApproved: true, needsApproval: false };
  }

  return { quote, autoApproved: false, needsApproval };
}
