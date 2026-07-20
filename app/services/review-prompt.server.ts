import prisma from "../db.server";
import { appendEvent } from "./events.server";

/**
 * App-store review prompt (S20) — the referral end of the AARRR funnel. We only
 * ask a merchant to review once they've had real value (at least one order
 * created through Mannon), and we ask at most once. Both signals come from the
 * append-only Event stream, so there's no extra state to keep.
 */

/** Eligible when the shop has created ≥1 order and hasn't been prompted yet. */
export async function shouldPromptReview(shopId: string): Promise<boolean> {
  const [orders, shown] = await Promise.all([
    prisma.event.count({ where: { shopId, type: "DRAFT_ORDER_CREATED" } }),
    prisma.event.count({ where: { shopId, type: "REVIEW_PROMPT_SHOWN" } }),
  ]);
  return orders > 0 && shown === 0;
}

/**
 * Record that the prompt was shown, exactly once. Guarded so a double submit or
 * a repeat visit never double-counts or re-nags the merchant.
 */
export async function markReviewPromptShown(shopId: string): Promise<boolean> {
  const shown = await prisma.event.count({
    where: { shopId, type: "REVIEW_PROMPT_SHOWN" },
  });
  if (shown > 0) return false;

  await appendEvent({
    shopId,
    type: "REVIEW_PROMPT_SHOWN",
    entityType: "Shop",
    entityId: shopId,
  });
  return true;
}
