import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F24.1 quote-form builder — Claude drafts the post-submit "thank you" message a
 * buyer sees after sending a quote request. The output pre-fills the merchant's
 * Thank-you message field; they review and Save (guardrail #4).
 */

export interface ThankYouInput {
  formName: string;
  surface: string; // PRODUCT | COLLECTION | CART | PAGE
  fieldLabels: string[];
}

export const THANKYOU_TOOL: AnthropicSDK.Tool = {
  name: "draft_thankyou",
  description: "Return a short thank-you confirmation message shown after a buyer submits a quote request.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "A warm 1-2 sentence confirmation that the request was received and what happens next. No links or placeholders.",
      },
    },
    required: ["message"],
  },
};

export const thankYouFeature = registerFeature<ThankYouInput>({
  key: "thankyou_message",
  system: withSharedRules(
    [
      "Task: write a short confirmation shown right after a wholesale buyer submits a quote request.",
      "Reassure them it was received and set the expectation that the merchant will follow up soon.",
      "1-2 warm sentences. No links, no placeholders, no store-name sign-off.",
    ].join("\n"),
  ),
  tool: THANKYOU_TOOL,
  buildUser: (input) => {
    const fields = input.fieldLabels.filter(Boolean);
    return [
      `Form name: ${input.formName || "Quote request"}`,
      `Where it appears: ${input.surface.toLowerCase()}`,
      fields.length ? `Fields the buyer filled in: ${fields.join(", ")}` : "Fields: (default contact fields)",
    ].join("\n");
  },
});
