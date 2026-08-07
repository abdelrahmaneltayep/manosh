import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F8 follow-ups — Claude drafts the body of a friendly reminder for a stalled
 * quote. The output pre-fills an editable message field; the merchant reviews it
 * and clicks Send now (guardrail #4). The quote link + unsubscribe footer are
 * appended by the send plumbing, so the model drafts only the persuasive body.
 */

export interface FollowupMessageInput {
  companyName: string;
  buyerName: string;
  daysSinceQuote: number;
  daysUntilExpiry: number;
}

export const FOLLOWUP_MESSAGE_TOOL: AnthropicSDK.Tool = {
  name: "draft_followup",
  description: "Return the body of a short, friendly reminder email for a stalled quote.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "The reminder body (2-4 short sentences). Warm, low-pressure, and specific about the quote waiting. Do NOT include links or a sign-off with the store name — those are added automatically.",
      },
    },
    required: ["message"],
  },
};

export const followupMessageFeature = registerFeature<FollowupMessageInput>({
  key: "followup_message",
  system: withSharedRules(
    [
      "Task: write the body of a gentle reminder to a wholesale buyer about an open quote.",
      "Be warm and low-pressure; acknowledge they're busy; make it easy to pick back up.",
      "2-4 short sentences. No links, no store-name sign-off (added automatically).",
    ].join("\n"),
  ),
  tool: FOLLOWUP_MESSAGE_TOOL,
  buildUser: (input) => {
    return [
      `Buyer: ${input.buyerName}`,
      `Company: ${input.companyName}`,
      `Days since the quote was sent: ${input.daysSinceQuote}`,
      input.daysUntilExpiry >= 0
        ? `Days until the quote expires: ${input.daysUntilExpiry}`
        : "The quote has passed its expiry date.",
    ].join("\n");
  },
});
