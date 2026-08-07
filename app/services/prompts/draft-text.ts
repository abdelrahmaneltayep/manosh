import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * A generic drafting helper so the foundation is exercisable end-to-end. Later
 * feature files register richer, screen-specific prompts.
 */

export interface DraftTextInput {
  /** What the merchant is drafting, e.g. "a follow-up note for a stalled quote". */
  task: string;
  /** Free-form context lines (already PII-scrubbed by the caller if needed). */
  context?: string[];
}

export const DRAFT_TEXT_TOOL: AnthropicSDK.Tool = {
  name: "return_draft",
  description: "Return a short drafted text for the merchant to review, edit, and send.",
  input_schema: {
    type: "object",
    properties: {
      draft: {
        type: "string",
        description: "The drafted text, ready for the merchant to review and edit.",
      },
    },
    required: ["draft"],
  },
};

export const draftTextFeature = registerFeature<DraftTextInput>({
  key: "draft_text",
  system: withSharedRules(
    "Task: write a short, friendly, professional piece of text the merchant asked for.\n" +
      "Keep it under 120 words unless the input clearly needs more.",
  ),
  tool: DRAFT_TEXT_TOOL,
  buildUser: (input) => {
    const lines = [`Draft: ${input.task}`];
    if (input.context?.length) {
      lines.push("", "Context:", ...input.context.map((c) => `- ${c}`));
    }
    return lines.join("\n");
  },
});
