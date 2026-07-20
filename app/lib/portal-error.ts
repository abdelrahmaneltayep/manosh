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
