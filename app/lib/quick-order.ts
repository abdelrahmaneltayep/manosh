// Client-safe types + copy for the quick-order pad. The resolver logic lives in
// quick-order.server.ts; these are shared with the client route, so they must
// NOT be in a .server module.

export interface ParsedRow {
  sku: string;
  quantity: number;
  /** The original line, for showing back unresolved rows verbatim. */
  raw: string;
}

export interface ResolvedLine {
  variantId: string;
  sku: string;
  title: string;
  quantity: number;
  price: string;
}

export type UnresolvedReason = "missing-sku" | "invalid-quantity" | "unknown-sku";

export interface UnresolvedRow {
  sku: string;
  quantity: number;
  raw: string;
  reason: UnresolvedReason;
}

export interface ResolveResult {
  resolved: ResolvedLine[];
  unresolved: UnresolvedRow[];
}

export const UNRESOLVED_MESSAGE: Record<UnresolvedReason, string> = {
  "missing-sku": "No SKU on this line",
  "invalid-quantity": "Quantity must be a whole number of 1 or more",
  "unknown-sku": "We couldn’t find this SKU in the catalog",
};
