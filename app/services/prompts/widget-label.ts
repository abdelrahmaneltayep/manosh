import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F21 storefront widget — Claude drafts a concise, action-oriented button label
 * for the storefront capture surface (e.g. the Make-an-Offer button). The output
 * pre-fills the merchant's label field; they review and Save (guardrail #4).
 */

export interface WidgetLabelInput {
  /** What the surface does, e.g. "Make an Offer button on product and cart pages". */
  context: string;
  currentLabel: string;
}

export const WIDGET_LABEL_TOOL: AnthropicSDK.Tool = {
  name: "draft_widget_label",
  description: "Return a short, action-oriented storefront button label.",
  input_schema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "A concise call-to-action of 2-4 words (e.g. 'Make an offer', 'Get a quote'). Title case, no trailing punctuation.",
      },
    },
    required: ["label"],
  },
};

export const widgetLabelFeature = registerFeature<WidgetLabelInput>({
  key: "widget_label",
  system: withSharedRules(
    [
      "Task: write a short, compelling call-to-action label for a storefront button.",
      "2-4 words, action-oriented, title case, no trailing punctuation.",
      "It must clearly match what the button does — never overstate or mislead.",
    ].join("\n"),
  ),
  tool: WIDGET_LABEL_TOOL,
  buildUser: (input) => {
    return [
      `Button purpose: ${input.context}`,
      input.currentLabel ? `Current label: ${input.currentLabel}` : "No current label.",
      "Return one strong label.",
    ].join("\n");
  },
});
