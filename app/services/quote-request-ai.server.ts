import prisma from "../db.server";
import { draft, type ClaudeInvoke } from "./claude.server";
import { getQuoteRequestForShop } from "./quote-widget.server";

/**
 * F17 quote requests — DB orchestration for the Claude acknowledgement-reply
 * draft. Loads the owned request context, calls draft() with the
 * quote_request_reply feature, and returns the reply body to pre-fill the
 * merchant's editable field. Nothing is sent here.
 */

export interface RequestReplyDraft {
  requestId: string;
  message: string;
}

/** Draft an acknowledgement reply for one owned request. Null when missing. */
export async function draftRequestReply(
  shopDomain: string,
  requestId: string,
  options: { invoke?: ClaudeInvoke } = {},
): Promise<RequestReplyDraft | null> {
  const req = await getQuoteRequestForShop(shopDomain, requestId);
  if (!req) return null;
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return null;

  const { output } = await draft({
    feature: "quote_request_reply",
    shopId: shop.id,
    input: { companyName: req.companyName, itemCount: req.itemCount, note: req.note },
    invoke: options.invoke,
  });

  const message = typeof output.message === "string" ? output.message.trim() : "";
  return { requestId, message };
}
