import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * AI-14 Upsell bundle — suggests complementary items to add to a quote/reorder,
 * chosen ONLY from the candidate list the caller passes in. Dual-mode: the
 * suggestions pre-fill a review list; the merchant adds them (or not) — nothing
 * is written to the quote by Claude. Guardrail: the model must not invent SKUs;
 * the caller re-validates every returned SKU against the live catalog before use.
 */

export interface UpsellCandidate {
  sku: string;
  title: string;
}
export interface UpsellBundleInput {
  /** Items already on the quote/order. */
  currentItems: { sku: string; title: string }[];
  /** The ONLY items Claude may suggest from (already catalog-scoped by caller). */
  candidates: UpsellCandidate[];
  /** How many suggestions to return at most. */
  maxSuggestions: number;
}

export const UPSELL_BUNDLE_TOOL: AnthropicSDK.Tool = {
  name: "suggest_upsell_bundle",
  description:
    "Return complementary items to suggest, chosen only from the provided candidate list.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sku: {
              type: "string",
              description: "MUST be a sku copied verbatim from the candidate list. Never invent one.",
            },
            reason: {
              type: "string",
              description: "One short phrase on why it complements the current items.",
            },
          },
          required: ["sku", "reason"],
        },
      },
    },
    required: ["suggestions"],
  },
};

export const upsellBundleFeature = registerFeature<UpsellBundleInput>({
  key: "upsell_bundle",
  system: withSharedRules(
    [
      "Task: suggest complementary add-on items for a wholesale order.",
      "CRITICAL: choose ONLY from the candidate list provided. Every 'sku' you return must be copied verbatim from that list — never invent, guess, or modify a sku.",
      "Prefer items that genuinely pair with what's already on the order. Skip anything already present.",
      "Return at most the requested number of suggestions; fewer is fine. If nothing fits, return an empty list.",
    ].join("\n"),
  ),
  tool: UPSELL_BUNDLE_TOOL,
  buildUser: (input) =>
    [
      "Items already on the order:",
      ...input.currentItems.map((i) => `- ${i.title} (${i.sku})`),
      "",
      `Candidate add-ons (suggest ONLY from these, at most ${input.maxSuggestions}):`,
      ...input.candidates.map((c) => `- ${c.title} (${c.sku})`),
    ].join("\n"),
});
