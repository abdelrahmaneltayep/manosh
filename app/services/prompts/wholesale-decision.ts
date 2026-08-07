import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F6 wholesale registration — Claude drafts a short, warm note to accompany an
 * application decision (approve / decline / request more info). The output
 * pre-fills an editable note field; the merchant reviews and clicks Send
 * decision (guardrail #4). Portal links are appended by the send.
 */

export type WholesaleDecision = "APPROVED" | "REJECTED" | "MORE_INFO";

export interface WholesaleDecisionInput {
  companyName: string;
  decision: WholesaleDecision;
}

const DECISION_INTENT: Record<WholesaleDecision, string> = {
  APPROVED: "welcome them and say they've been approved for wholesale access",
  REJECTED: "politely decline their wholesale application, kindly and without over-explaining",
  MORE_INFO: "ask, warmly, for the additional information you need to approve them",
};

export const WHOLESALE_DECISION_TOOL: AnthropicSDK.Tool = {
  name: "draft_decision_note",
  description: "Return a short, warm note to the applicant accompanying the merchant's decision.",
  input_schema: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description:
          "The note body (2-3 short sentences). Warm and professional. No links or store-name sign-off — those are added automatically.",
      },
    },
    required: ["note"],
  },
};

export const wholesaleDecisionFeature = registerFeature<WholesaleDecisionInput>({
  key: "wholesale_decision",
  system: withSharedRules(
    [
      "Task: write a short note to a wholesale applicant accompanying the merchant's decision.",
      "Match the decision's tone exactly; never promise access on a decline or a more-info request.",
      "2-3 short sentences. No links, no store-name sign-off (added automatically).",
    ].join("\n"),
  ),
  tool: WHOLESALE_DECISION_TOOL,
  buildUser: (input) => {
    return [
      `Company: ${input.companyName}`,
      `Decision: ${input.decision}`,
      `Goal: ${DECISION_INTENT[input.decision]}.`,
    ].join("\n");
  },
});
