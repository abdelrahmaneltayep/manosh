// App-store review prompt, the Shopify way (App Bridge Reviews API).
//
// Mannon used to show its own "Leave a review" button linking to
// apps.shopify.com. Inside the embedded admin that link loaded in the app's own
// frame, which Shopify refuses ("apps.shopify.com refused to connect") and left
// the app blank until a reload (App Store review 2.1.1). The Reviews API asks
// Shopify to show its native review modal over the app instead: no link, no
// navigation, and Shopify decides eligibility and rate limits.
//
// Shopify's guidance: never tie the request to a button, because a declined
// request shows nothing and looks broken. So it is requested from an effect,
// once the merchant has had real value (see review-prompt.server.ts).

export interface ReviewRequestResult {
  success: boolean;
  code?: string;
  message?: string;
}

/** The slice of App Bridge's `shopify` global this needs. */
export interface ReviewsBridge {
  reviews?: { request?: () => Promise<ReviewRequestResult | undefined> };
}

/**
 * Whether Mannon should stop asking after this result. True when Shopify showed
 * the modal, or the merchant has already reviewed. Every other decline (cooldown,
 * installed under 24 hours ago, not eligible, mobile) leaves the prompt pending,
 * so a later visit can ask again and Shopify decides again. Pure.
 */
export function shouldRecordReviewPrompt(result: ReviewRequestResult | null | undefined): boolean {
  if (!result) return false;
  return result.success === true || result.code === "already-reviewed";
}

/**
 * Ask Shopify to show its review modal. Never throws and never navigates;
 * resolves to whether the prompt should be recorded as shown.
 */
export async function requestReview(shopify: ReviewsBridge | null | undefined): Promise<boolean> {
  const reviews = shopify?.reviews;
  if (typeof reviews?.request !== "function") return false;
  try {
    return shouldRecordReviewPrompt(await reviews.request());
  } catch {
    return false;
  }
}
