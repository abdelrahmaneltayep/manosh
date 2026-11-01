// Friendly, plain-language copy for the buyer-portal error boundary. Pure and
// client-safe so it's unit-testable without a DOM: the boundary extracts an
// HTTP status (via isRouteErrorResponse) and this maps it to what the buyer
// reads. Never a raw stack trace (definition of done).

export interface PortalErrorContent {
  title: string;
  body: string;
}

/**
 * Map a thrown route-response status to buyer-facing copy. `null` = an
 * unexpected (non-Response) error → the generic message.
 */
export function portalErrorContent(status: number | null): PortalErrorContent {
  if (status === 404) {
    return {
      title: "We couldn’t find that",
      body: "This link may be out of date, or the item is no longer available. Head back to your portal and try again.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      title: "Please sign in again",
      body: "Your secure sign-in link may have expired. Ask your supplier to send you a fresh one.",
    };
  }
  return {
    title: "Something went wrong",
    body: "We hit an unexpected problem. Please refresh and try again — if it keeps happening, contact your supplier.",
  };
}

/**
 * Buyer-facing copy for an accept that failed for a reason other than a
 * DraftOrderError (those already carry a plain-language message). A GraphQL
 * error from Shopify (`body.errors[]`, e.g. a missing scope or a rejected
 * input) is named so the buyer and the merchant can act on it; anything else
 * gets the generic retry line. Pure; never echoes a stack trace.
 */
export function acceptFailureMessage(error: unknown): string {
  const generic = "We couldn’t create your order just now. Please try again.";
  const graphqlErrors = (error as { body?: { errors?: Array<{ message?: string }> } } | null)?.body?.errors;
  const first = Array.isArray(graphqlErrors) ? graphqlErrors.find((e) => e?.message)?.message : undefined;
  if (first) return `Shopify couldn’t create the order: ${first.trim().replace(/\.?$/, ".")} Please contact your supplier.`;
  const message = error instanceof Error ? error.message : "";
  if (/not found|no session|offline session|access token|expired/i.test(message)) {
    return "Your supplier’s store connection needs a refresh. Please try again in a moment or contact your supplier.";
  }
  return generic;
}
