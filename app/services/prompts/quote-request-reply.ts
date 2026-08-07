import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F17 quote requests — Claude drafts a warm acknowledgement reply to a
 * storefront quote request. The output pre-fills an editable message the
 * merchant reviews and sends to the requester (guardrail #4). Links/sign-off are
 * appended by the send.
 */

export interface QuoteRequestReplyInput {
  companyName: string | null;
  itemCount: number;
  note: string | null;
}

export const QUOTE_REQUEST_REPLY_TOOL: AnthropicSDK.Tool = {
  name: "draft_request_reply",
  description: "Return a short, warm acknowledgement reply to a storefront quote request.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "The reply body (2-3 short sentences): thank them, confirm the request was received, and say a quote is on its way. No links or store-name sign-off.",
      },
    },
    required: ["message"],
  },
};

export const quoteRequestReplyFeature = registerFeature<QuoteRequestReplyInput>({
  key: "quote_request_reply",
  system: withSharedRules(
    [
      "Task: acknowledge a wholesale buyer's quote request submitted from the storefront.",
      "Thank them, confirm receipt, and set the expectation that a quote is being prepared.",
      "If they left a note, acknowledge it briefly. 2-3 warm sentences. No links or sign-off.",
    ].join("\n"),
  ),
  tool: QUOTE_REQUEST_REPLY_TOOL,
  buildUser: (input) => {
    return [
      input.companyName ? `Company: ${input.companyName}` : "Company: (not provided)",
      `Items requested: ${input.itemCount}`,
      input.note ? `Their note: ${input.note}` : "No note left.",
    ].join("\n");
  },
});
